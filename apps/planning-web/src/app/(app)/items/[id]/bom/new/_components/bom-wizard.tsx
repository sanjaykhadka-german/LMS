"use client";

/**
 * BOM wizard.
 *
 * Three-step guided BOM creation for an item that's already been set up.
 *   1. Weight ingredients  — recipe components measured by weight (kg). The
 *                            wizard shows live percentages; the save trigger
 *                            normalises them on insert so they always sum to 100.
 *   2. Packaging & extras  — count-based components (boxes, labels, films,
 *                            pallet corners) with a "basis" picker that
 *                            explains what each option means in plain words.
 *   3. Review & save       — full BOM table, validation summary, save button.
 *
 * On save → bom_header (next version) + bom_lines (one per row), then
 * redirect to /items/[id]?openTest=1&qty=...&uom=... so the sanity check
 * (test_product_cascade) auto-opens with sensible defaults.
 *
 * Need an ingredient that doesn't exist? "+ Create new item" link opens the
 * Raw Material wizard in a new tab. Come back, click the small "↻ Refresh
 * components" link, and it appears in the picker.
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";
import { SearchableSelect } from "@/components/searchable-select";

type Parent = {
  id: string; code: string; name: string; item_type: string;
  unit: string | null; target_weight_g: number | null;
  default_batch_size: number | null; batch_unit: string | null;
};
type ComponentItem = { id: string; code: string; name: string; item_type: string; unit: string | null };
type UomDef = { id: string; code: string; name: string; category: string | null };

type WeightLine = {
  rowId: number;
  componentId: string;
  qtyKg: string;
  comment: string;
};
type PackLine = {
  rowId: number;
  componentId: string;
  qty: string;
  basis: "per_piece" | "per_inner" | "per_outer" | "per_pallet" | "per_kg";
};

const STEPS = [
  { id: "ingredients", label: "Weight ingredients" },
  { id: "packaging",   label: "Packaging / extras" },
  { id: "review",      label: "Review & save" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

const BASIS_OPTIONS: { val: PackLine["basis"]; label: string; sub: string }[] = [
  { val: "per_piece",  label: "Per piece",     sub: "1 of these per finished piece (e.g. 1 label)" },
  { val: "per_inner",  label: "Per inner",     sub: "1 per inner pack (e.g. 1 vacuum bag per 20 pcs)" },
  { val: "per_outer",  label: "Per outer",     sub: "1 per outer carton (e.g. 1 box per 7 inners)" },
  { val: "per_pallet", label: "Per pallet",    sub: "1 per pallet (e.g. 4 pallet corners per pallet)" },
  { val: "per_kg",     label: "Per kg",        sub: "Quantity scales linearly with weight" },
];

export default function BomWizard({
  tenantId, parent, components, uoms, nextVersion,
}: {
  tenantId: string;
  parent: Parent;
  components: ComponentItem[];
  uoms: UomDef[];
  nextVersion: number;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx].id;

  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshedComponents, setRefreshedComponents] = useState<ComponentItem[] | null>(null);
  const liveComponents = refreshedComponents ?? components;

  // Reference batch size — used as the BOM header's reference. Defaults to 1000 kg
  // for weight-mode parents, or item.default_batch_size if set.
  const [batchSize, setBatchSize] = useState<string>(
    parent.default_batch_size != null
      ? String(parent.default_batch_size)
      : "1000"
  );
  const [yieldFactor, setYieldFactor] = useState<string>("1.0");

  const [weightLines, setWeightLines] = useState<WeightLine[]>([
    { rowId: 1, componentId: "", qtyKg: "", comment: "" },
  ]);
  const [packLines, setPackLines] = useState<PackLine[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-fetch component list (after user creates a new item in another tab)
  const refreshComponents = useCallback(async () => {
    const { data } = await supabase
      .from("items")
      .select("id, code, name, item_type, unit")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .neq("id", parent.id)
      .order("code");
    setRefreshedComponents((data ?? []) as ComponentItem[]);
    setRefreshKey(k => k + 1);
  }, [supabase, tenantId, parent.id]);

  // ─── Derived state ────────────────────────────────────────
  const totalWeight = useMemo(() => {
    return weightLines
      .filter(l => l.componentId && l.qtyKg && parseFloat(l.qtyKg) > 0)
      .reduce((sum, l) => sum + parseFloat(l.qtyKg), 0);
  }, [weightLines]);

  const weightWithPercent = useMemo(() => {
    return weightLines.map(l => {
      const q = l.qtyKg ? parseFloat(l.qtyKg) : 0;
      const pct = totalWeight > 0 ? (q / totalWeight) * 100 : 0;
      return { ...l, pct };
    });
  }, [weightLines, totalWeight]);

  // ─── Validation ───────────────────────────────────────────
  const canProceed = useMemo(() => {
    if (step === "ingredients") {
      // At least one valid weight line OR none if no weight rows desired (allow zero — packaging-only BOMs exist)
      return weightLines.every(l => !l.componentId || (l.qtyKg && parseFloat(l.qtyKg) > 0));
    }
    if (step === "packaging") {
      return packLines.every(l => !l.componentId || (l.qty && parseFloat(l.qty) > 0));
    }
    if (step === "review") {
      const validWeight = weightLines.filter(l => l.componentId && parseFloat(l.qtyKg) > 0);
      const validPack = packLines.filter(l => l.componentId && parseFloat(l.qty) > 0);
      return !saving && (validWeight.length > 0 || validPack.length > 0)
              && batchSize && parseFloat(batchSize) > 0;
    }
    return false;
  }, [step, weightLines, packLines, batchSize, saving]);

  function next() {
    setError(null);
    if (!canProceed) return;
    setStepIdx(i => Math.min(i + 1, STEPS.length - 1));
  }
  function prev() {
    setError(null);
    setStepIdx(i => Math.max(i - 1, 0));
  }
  function goTo(s: StepId) {
    const i = STEPS.findIndex(x => x.id === s);
    if (i >= 0 && i <= stepIdx) setStepIdx(i);
  }

  // ─── Weight line helpers ──────────────────────────────────
  function addWeightRow() {
    const newId = (weightLines[weightLines.length - 1]?.rowId ?? 0) + 1;
    setWeightLines([...weightLines, { rowId: newId, componentId: "", qtyKg: "", comment: "" }]);
  }
  function removeWeightRow(rowId: number) {
    setWeightLines(weightLines.filter(l => l.rowId !== rowId));
  }
  function updateWeightRow(rowId: number, patch: Partial<WeightLine>) {
    setWeightLines(weightLines.map(l => l.rowId === rowId ? { ...l, ...patch } : l));
  }

  // ─── Pack line helpers ────────────────────────────────────
  function addPackRow() {
    const newId = (packLines[packLines.length - 1]?.rowId ?? 0) + 1;
    setPackLines([...packLines, { rowId: newId, componentId: "", qty: "1", basis: "per_piece" }]);
  }
  function removePackRow(rowId: number) {
    setPackLines(packLines.filter(l => l.rowId !== rowId));
  }
  function updatePackRow(rowId: number, patch: Partial<PackLine>) {
    setPackLines(packLines.map(l => l.rowId === rowId ? { ...l, ...patch } : l));
  }

  // ─── Save ─────────────────────────────────────────────────
  async function save() {
    setSaving(true);
    setError(null);

    const validWeight = weightLines.filter(l => l.componentId && parseFloat(l.qtyKg) > 0);
    const validPack   = packLines.filter(l => l.componentId && parseFloat(l.qty) > 0);

    // Insert bom_header
    const { data: bomRow, error: hdrErr } = await supabase
      .from("bom_headers")
      .insert({
        tenant_id:             tenantId,
        item_id:               parent.id,
        version:               nextVersion,
        reference_batch_size:  parseFloat(batchSize),
        reference_batch_unit:  parent.batch_unit ?? "kg",
        yield_factor:          parseFloat(yieldFactor) || 1.0,
        is_active:             true,
      })
      .select("id")
      .single();
    if (hdrErr) {
      setSaving(false);
      setError("BOM header insert failed: " + hdrErr.message);
      return;
    }
    const bomHeaderId = (bomRow as { id: string }).id;

    // Insert bom_lines — weight rows first, then pack rows
    const linePayloads = [
      ...validWeight.map((l, i) => {
        const comp = liveComponents.find(c => c.id === l.componentId);
        return {
          bom_header_id:     bomHeaderId,
          component_item_id: l.componentId,
          qty_per_batch:     parseFloat(l.qtyKg),
          unit:              "kg",
          basis:             null as string | null,
          comment:           l.comment.trim() || null,
          sort_order:        i,
        };
      }),
      ...validPack.map((l, i) => {
        const comp = liveComponents.find(c => c.id === l.componentId);
        return {
          bom_header_id:     bomHeaderId,
          component_item_id: l.componentId,
          qty_per_batch:     parseFloat(l.qty),
          unit:              comp?.unit ?? "ea",
          basis:             l.basis,
          comment:           null,
          sort_order:        validWeight.length + i,
        };
      }),
    ];

    if (linePayloads.length === 0) {
      setSaving(false);
      setError("No valid BOM lines to save.");
      return;
    }

    const { error: linesErr } = await supabase.from("bom_lines").insert(linePayloads);
    if (linesErr) {
      setSaving(false);
      setError("BOM lines insert failed: " + linesErr.message + " (header was created — open the BOM editor to fix lines).");
      router.push(`/items/${parent.id}`);
      return;
    }

    setSaving(false);
    // Redirect to item detail with sanity check auto-open
    const testQty = parent.target_weight_g != null ? "100" : "100";
    const testUom = parent.target_weight_g != null ? "units" : "kg";
    router.push(`/items/${parent.id}?openTest=1&qty=${testQty}&uom=${testUom}`);
  }

  // ─── Render ───────────────────────────────────────────────
  return (
    <div style={{ maxWidth: "980px" }}>
      <BackButton href={`/items/${parent.id}`} label="Item" />

      <div className="page-header">
        <div>
          <h1 className="page-title">
            BOM for {parent.name}
            <span style={{ fontFamily: "monospace", fontSize: "1rem", fontWeight: 400, color: "#78716c", marginLeft: "0.5rem" }}>
              ({parent.code})
            </span>
          </h1>
          <p className="page-subtitle">
            Build the recipe step by step. Tracey computes percentages automatically — you
            just type the quantities you actually use.{" "}
            <span style={{ color: "#a8a29e" }}>· Saving as v{nextVersion}</span>
          </p>
        </div>
        <Link
          href="/items/new/start"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary"
          style={{ fontSize: "0.8125rem" }}
        >+ Create new item ↗</Link>
      </div>

      {/* ─── Step indicator ─── */}
      <div style={{ display: "flex", gap: 0, marginBottom: "1.5rem" }}>
        {STEPS.map((s, i) => {
          const active = i === stepIdx;
          const done   = i < stepIdx;
          return (
            <div
              key={s.id}
              onClick={() => i <= stepIdx && goTo(s.id)}
              style={{
                flex: 1, padding: "0.625rem 0.75rem",
                background: active ? "#1c1917" : "#ffffff",
                color: active ? "#ffffff" : (done ? "#0f6e56" : "#a8a29e"),
                border: "1px solid",
                borderColor: active ? "#1c1917" : "#e7e5e4",
                borderRightWidth: i === STEPS.length - 1 ? 1 : 0,
                fontSize: "0.75rem", fontWeight: active ? 600 : 500,
                textAlign: "center",
                cursor: i <= stepIdx ? "pointer" : "default",
                borderRadius:
                  i === 0 ? "0.375rem 0 0 0.375rem" :
                  i === STEPS.length - 1 ? "0 0.375rem 0.375rem 0" : 0,
              }}
            >
              <span style={{ marginRight: "0.4rem" }}>{done ? "✓" : `${i + 1}.`}</span>
              {s.label}
            </div>
          );
        })}
      </div>

      <div className="card" style={{ padding: "1.5rem" }}>
        {/* ─── Step 1: Weight ingredients ─── */}
        {step === "ingredients" && (
          <>
            <h2 style={{ fontSize: "1.125rem", margin: "0 0 0.4rem" }}>What ingredients go in?</h2>
            <p className="subtle" style={{ margin: "0 0 1rem" }}>
              Type quantities in kg as you'd actually weigh them. Tracey auto-computes
              percentages live — they save with the BOM and drive every cascade calculation.
            </p>

            <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: "0.8125rem", color: "#57534e" }}>
                Reference batch size:&nbsp;
                <input
                  type="number" step="1" min="1"
                  value={batchSize}
                  onChange={e => setBatchSize(e.target.value)}
                  style={{
                    width: "100px", padding: "0.25rem 0.4rem",
                    border: "1px solid #cfc9bf", borderRadius: "0.25rem",
                    fontSize: "0.8125rem", fontFamily: "inherit",
                  }}
                />{" "}kg
                <span style={{ marginLeft: "0.4rem", fontSize: "0.7rem", color: "#a8a29e" }}>
                  (informational — percentages drive the math)
                </span>
              </div>
              <button
                type="button"
                onClick={refreshComponents}
                style={{
                  background: "transparent", border: "1px solid #e7e5e4",
                  color: "#57534e", borderRadius: "0.25rem",
                  padding: "0.25rem 0.625rem", fontSize: "0.7rem",
                  cursor: "pointer", fontFamily: "inherit",
                }}
                title="Re-fetch the component list (after creating a new item in another tab)"
              >↻ Refresh components</button>
            </div>

            <table className="data-table" style={{ fontSize: "0.875rem" }}>
              <thead>
                <tr>
                  <th style={{ width: "38%" }}>Ingredient</th>
                  <th style={{ width: "120px", textAlign: "right" }}>Qty (kg)</th>
                  <th style={{ width: "100px", textAlign: "right" }}>% of recipe</th>
                  <th>Comment</th>
                  <th style={{ width: "80px" }}></th>
                </tr>
              </thead>
              <tbody>
                {weightWithPercent.map(l => (
                  <tr key={`${l.rowId}-${refreshKey}`}>
                    <td>
                      <SearchableSelect
                        value={l.componentId}
                        onChange={v => updateWeightRow(l.rowId, { componentId: v })}
                        options={liveComponents
                          .filter(c => c.unit === "kg" || c.item_type === "raw_material" || c.item_type === "wip" || c.item_type === "wipf" || c.item_type === "wipp")
                          .map(c => ({
                            value: c.id,
                            label: `${c.code} — ${c.name}${c.unit && c.unit !== "kg" ? ` (${c.unit})` : ""}`,
                          }))
                        }
                        placeholder="Search ingredients…"
                      />
                    </td>
                    <td>
                      <input
                        type="number" step="0.001" min="0"
                        value={l.qtyKg}
                        onChange={e => updateWeightRow(l.rowId, { qtyKg: e.target.value })}
                        className="form-input"
                        style={{ textAlign: "right", fontFamily: "monospace" }}
                      />
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "monospace", color: l.pct > 0 ? "#1c1917" : "#a8a29e" }}>
                      {l.pct > 0 ? l.pct.toFixed(2) + "%" : "—"}
                    </td>
                    <td>
                      <input
                        type="text"
                        value={l.comment}
                        onChange={e => updateWeightRow(l.rowId, { comment: e.target.value })}
                        className="form-input"
                        placeholder="optional notes"
                      />
                    </td>
                    <td>
                      {weightLines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeWeightRow(l.rowId)}
                          style={{
                            background: "transparent", border: "1px solid #fca5a5",
                            color: "#dc2626", borderRadius: "0.25rem",
                            padding: "0.2rem 0.5rem", fontSize: "0.7rem",
                            cursor: "pointer", fontFamily: "inherit",
                          }}
                        >Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr style={{ background: "#fafaf9", borderTop: "2px solid #1c1917" }}>
                  <td style={{ fontWeight: 700, padding: "0.625rem 0.5rem" }}>Total</td>
                  <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>
                    {totalWeight.toFixed(3)} kg
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>
                    {totalWeight > 0 ? "100.00%" : "—"}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>

            <button
              type="button"
              onClick={addWeightRow}
              style={{
                width: "100%", padding: "0.5rem", marginTop: "0.5rem",
                border: "2px dashed #cfc9bf", background: "transparent",
                borderRadius: "0.5rem", color: "#78716c", cursor: "pointer",
                fontSize: "0.8125rem", fontFamily: "inherit",
              }}
            >+ Add ingredient row</button>

            <p style={{ marginTop: "0.875rem", fontSize: "0.75rem", color: "#a8a29e" }}>
              Need an ingredient that doesn't exist yet?
              {" "}<Link href="/items/new/start" target="_blank" style={{ color: "#b91c1c", textDecoration: "none", fontWeight: 600 }}>
                Create it in a new tab →
              </Link>
              {" "}then click <strong>↻ Refresh components</strong> above.
            </p>
          </>
        )}

        {/* ─── Step 2: Packaging / extras ─── */}
        {step === "packaging" && (
          <>
            <h2 style={{ fontSize: "1.125rem", margin: "0 0 0.4rem" }}>Packaging &amp; extras</h2>
            <p className="subtle" style={{ margin: "0 0 1rem" }}>
              Add count-based components — boxes, labels, films, casings, pallet corners.
              Pick the right <strong>basis</strong> so the cascade scales correctly with order size.
            </p>

            {packLines.length === 0 && (
              <div style={{
                padding: "1.5rem", textAlign: "center", color: "#78716c", fontSize: "0.875rem",
                background: "#fafaf9", borderRadius: "0.5rem", marginBottom: "0.5rem",
              }}>
                No packaging or extras yet. Skip to the next step if there are none, or click below to add.
              </div>
            )}

            {packLines.map((l) => (
              <div
                key={`${l.rowId}-${refreshKey}`}
                style={{
                  border: "1px solid #e7e5e4", borderRadius: "0.5rem",
                  padding: "0.75rem", marginBottom: "0.625rem",
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "2.5fr 100px 1.5fr 80px", gap: "0.625rem", alignItems: "end" }}>
                  <div>
                    <label className="form-label" style={{ fontSize: "0.6875rem" }}>Component *</label>
                    <SearchableSelect
                      value={l.componentId}
                      onChange={v => updatePackRow(l.rowId, { componentId: v })}
                      options={liveComponents
                        .filter(c => c.item_type === "packaging" || c.item_type === "consumable" || c.item_type === "raw_material")
                        .map(c => ({
                          value: c.id,
                          label: `${c.code} — ${c.name}${c.unit ? ` (${c.unit})` : ""}`,
                        }))
                      }
                      placeholder="Search packaging…"
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: "0.6875rem" }}>Qty *</label>
                    <input
                      type="number" step="0.001" min="0"
                      value={l.qty}
                      onChange={e => updatePackRow(l.rowId, { qty: e.target.value })}
                      className="form-input"
                      style={{ textAlign: "right", fontFamily: "monospace" }}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: "0.6875rem" }}>Basis *</label>
                    <select
                      className="form-input"
                      value={l.basis}
                      onChange={e => updatePackRow(l.rowId, { basis: e.target.value as PackLine["basis"] })}
                    >
                      {BASIS_OPTIONS.map(b => (
                        <option key={b.val} value={b.val}>{b.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => removePackRow(l.rowId)}
                      style={{
                        width: "100%", padding: "0.4rem",
                        border: "1px solid #fca5a5", background: "transparent",
                        color: "#dc2626", borderRadius: "0.25rem",
                        fontSize: "0.7rem", cursor: "pointer", fontFamily: "inherit",
                      }}
                    >Remove</button>
                  </div>
                </div>
                <p style={{ fontSize: "0.7rem", color: "#a8a29e", margin: "0.4rem 0 0" }}>
                  {BASIS_OPTIONS.find(b => b.val === l.basis)?.sub}
                </p>
              </div>
            ))}

            <button
              type="button"
              onClick={addPackRow}
              style={{
                width: "100%", padding: "0.5rem",
                border: "2px dashed #cfc9bf", background: "transparent",
                borderRadius: "0.5rem", color: "#78716c", cursor: "pointer",
                fontSize: "0.8125rem", fontFamily: "inherit",
              }}
            >+ Add packaging / extra row</button>
          </>
        )}

        {/* ─── Step 3: Review ─── */}
        {step === "review" && (
          <>
            <h2 style={{ fontSize: "1.125rem", margin: "0 0 0.4rem" }}>BOM looks like this</h2>
            <p className="subtle" style={{ margin: "0 0 1.25rem" }}>
              Save will create version <strong>v{nextVersion}</strong> and immediately run a sanity-check cascade so you can verify the math.
            </p>

            <table className="data-table" style={{ fontSize: "0.8125rem" }}>
              <thead>
                <tr>
                  <th style={{ width: "120px" }}>Type</th>
                  <th>Component</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ width: "80px" }}>Unit</th>
                  <th style={{ textAlign: "right" }}>%</th>
                  <th>Basis</th>
                </tr>
              </thead>
              <tbody>
                {weightWithPercent
                  .filter(l => l.componentId && parseFloat(l.qtyKg) > 0)
                  .map(l => {
                    const c = liveComponents.find(x => x.id === l.componentId);
                    return (
                      <tr key={l.rowId}>
                        <td><span className="badge badge-blue" style={{ fontSize: "0.6875rem" }}>Weight</span></td>
                        <td>{c?.code} — {c?.name}</td>
                        <td style={{ textAlign: "right", fontFamily: "monospace" }}>{l.qtyKg}</td>
                        <td>kg</td>
                        <td style={{ textAlign: "right", fontFamily: "monospace" }}>{l.pct.toFixed(2)}%</td>
                        <td style={{ color: "#a8a29e" }}>—</td>
                      </tr>
                    );
                  })}
                {packLines
                  .filter(l => l.componentId && parseFloat(l.qty) > 0)
                  .map(l => {
                    const c = liveComponents.find(x => x.id === l.componentId);
                    const basisLabel = BASIS_OPTIONS.find(b => b.val === l.basis)?.label;
                    return (
                      <tr key={`pack-${l.rowId}`}>
                        <td><span className="badge badge-yellow" style={{ fontSize: "0.6875rem" }}>Count</span></td>
                        <td>{c?.code} — {c?.name}</td>
                        <td style={{ textAlign: "right", fontFamily: "monospace" }}>{l.qty}</td>
                        <td>{c?.unit ?? "ea"}</td>
                        <td style={{ color: "#a8a29e" }}>—</td>
                        <td>{basisLabel}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>

            <div style={{
              marginTop: "1rem", padding: "0.75rem 1rem",
              background: "#dcfce7", border: "1px solid #86efac",
              borderRadius: "0.5rem", fontSize: "0.8125rem", color: "#166534",
            }}>
              <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>What happens on save</div>
              <ol style={{ margin: 0, paddingLeft: "1.25rem", lineHeight: 1.7 }}>
                <li>BOM v{nextVersion} created and marked active.</li>
                <li>Save trigger normalises percentages on insert — they always sum to 100% for the weight rows.</li>
                <li>Sanity check (▷ Test this product) auto-opens with 100 units so you can verify the cascade math right away.</li>
              </ol>
            </div>

            {error && (
              <div style={{
                marginTop: "1rem", padding: "0.75rem 1rem",
                background: "#fef2f2", border: "1px solid #fca5a5",
                borderRadius: "0.5rem", fontSize: "0.875rem", color: "#991b1b",
              }}>{error}</div>
            )}
          </>
        )}
      </div>

      {/* ─── Step nav ─── */}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem", justifyContent: "space-between" }}>
        <button
          type="button" onClick={prev} disabled={stepIdx === 0}
          className="btn-secondary"
          style={{ visibility: stepIdx === 0 ? "hidden" : "visible" }}
        >← Back</button>
        {step !== "review" ? (
          <button type="button" onClick={next} disabled={!canProceed} className="btn-primary">Next →</button>
        ) : (
          <button type="button" onClick={save} disabled={saving || !canProceed} className="btn-primary" style={{ minWidth: "220px" }}>
            {saving ? "Saving…" : "✓ Save BOM & run sanity check"}
          </button>
        )}
      </div>
    </div>
  );
}
