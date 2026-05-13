"use client";

/**
 * Per-BOM routing editor.
 *
 * Each row = (department, step name, people, minutes, ref qty, ref basis).
 * $/kg is computed live in the browser using the props' hourly rate +
 * pack hierarchy of the BOM's owning item, so Tino sees the labour
 * impact as he types. Save bulk-replaces the routing for this BOM:
 * delete removed rows, upsert kept/new rows.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type Basis = "kg" | "unit" | "inner" | "outer" | "pallet";

export type RoutingStep = {
  id: string | null;     // null until first save
  department_id: string;
  step_name: string;
  people_count: string;  // string for input binding; converted at save
  std_minutes:  string;
  reference_qty: string;
  reference_basis: Basis;
  sort_order: number;
  notes: string;
  _tempKey: string;      // stable React key — uses id when present, else generated
};

export type DeptOption = { id: string; name: string; code: string | null };

const BASIS_OPTIONS: { value: Basis; label: string }[] = [
  { value: "kg",     label: "kg" },
  { value: "unit",   label: "unit (piece)" },
  { value: "inner",  label: "inner" },
  { value: "outer",  label: "outer" },
  { value: "pallet", label: "pallet" },
];

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return "$" + v.toLocaleString("en-AU", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

let tempCounter = 0;
function newTempKey(): string { tempCounter += 1; return `_new_${Date.now()}_${tempCounter}`; }

export default function RoutingEditor({
  bomHeaderId,
  bomItemTargetWeightG,
  bomItemUnitsPerInner,
  bomItemUnitsPerOuter,
  bomItemUnitsPerPallet,
  currentHourlyRate,
  currentRateEffectiveFrom,
  initialSteps,
  deptOptions,
}: {
  bomHeaderId: string;
  bomItemTargetWeightG: number | null;
  bomItemUnitsPerInner: number | null;
  bomItemUnitsPerOuter: number | null;
  bomItemUnitsPerPallet: number | null;
  currentHourlyRate: number | null;
  currentRateEffectiveFrom: string | null;
  initialSteps: RoutingStep[];
  deptOptions: DeptOption[];
}) {
  const supabase = createClient();
  const router = useRouter();

  const [steps, setSteps] = useState<RoutingStep[]>(initialSteps);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // ── Compute $/kg per step (and totals) using props (no DB roundtrip).
  function kgPerRef(s: RoutingStep): number | null {
    const refQty = Number(s.reference_qty) || 0;
    if (refQty <= 0) return null;
    switch (s.reference_basis) {
      case "kg":     return refQty;
      case "unit":   return bomItemTargetWeightG && bomItemTargetWeightG > 0
                       ? refQty * bomItemTargetWeightG / 1000 : null;
      case "inner":  return bomItemTargetWeightG && bomItemUnitsPerInner && bomItemUnitsPerInner > 0
                       ? refQty * bomItemUnitsPerInner * bomItemTargetWeightG / 1000 : null;
      case "outer":  return bomItemTargetWeightG && bomItemUnitsPerOuter && bomItemUnitsPerOuter > 0
                       ? refQty * bomItemUnitsPerOuter * bomItemTargetWeightG / 1000 : null;
      case "pallet": return bomItemTargetWeightG && bomItemUnitsPerPallet && bomItemUnitsPerPallet > 0
                       ? refQty * bomItemUnitsPerPallet * bomItemTargetWeightG / 1000 : null;
    }
  }

  function dollarsPerKg(s: RoutingStep): number | null {
    if (currentHourlyRate == null || currentHourlyRate <= 0) return null;
    const ph = (Number(s.people_count) || 0) * (Number(s.std_minutes) || 0) / 60;
    if (ph <= 0) return null;
    const kg = kgPerRef(s);
    if (kg == null || kg <= 0) return null;
    return ph * currentHourlyRate / kg;
  }

  // ── Aggregates used at the bottom of the page.
  const totals = useMemo(() => {
    let total = 0; let computable = 0; let uncomputable = 0;
    const byDept = new Map<string, number>();
    for (const s of steps) {
      const dpk = dollarsPerKg(s);
      if (dpk == null) { uncomputable += 1; continue; }
      computable += 1;
      total += dpk;
      const dn = deptOptions.find(d => d.id === s.department_id)?.name ?? "—";
      byDept.set(dn, (byDept.get(dn) ?? 0) + dpk);
    }
    return { total, computable, uncomputable, byDept };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, currentHourlyRate, bomItemTargetWeightG, bomItemUnitsPerInner, bomItemUnitsPerOuter, bomItemUnitsPerPallet]);

  function update(key: string, patch: Partial<RoutingStep>) {
    setSteps(prev => prev.map(s => s._tempKey === key ? { ...s, ...patch } : s));
    setSaved(false);
  }

  function addRow(focusFirst = false): void {
    const key = newTempKey();
    setSteps(prev => [...prev, {
      id: null,
      department_id: deptOptions[0]?.id ?? "",
      step_name: "",
      people_count: "1",
      std_minutes:  "60",
      reference_qty: "1000",
      reference_basis: "kg",
      sort_order: prev.length,
      notes: "",
      _tempKey: key,
    }]);
    setSaved(false);
    if (focusFirst) {
      // Wait for React to commit the new row, then focus its first field.
      // requestAnimationFrame is safer than setTimeout(0) under StrictMode.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = document.querySelector(
          `[data-row-key="${key}"] [data-first-field]`
        ) as HTMLElement | null;
        el?.focus();
      }));
    }
  }

  // Tab on the LAST input of the LAST row → preventDefault + add a new row
  // and focus its first field. Lets operators power-type a routing without
  // ever reaching for the mouse. Tino May 2026.
  function onLastCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>, isLastRow: boolean) {
    if (e.key === "Tab" && !e.shiftKey && isLastRow) {
      e.preventDefault();
      addRow(true);
    }
  }

  function removeRow(key: string) {
    setSteps(prev => {
      const next = prev.filter(s => s._tempKey !== key);
      const removed = prev.find(s => s._tempKey === key);
      if (removed?.id) setDeletedIds(d => [...d, removed.id!]);
      return next.map((s, i) => ({ ...s, sort_order: i }));
    });
    setSaved(false);
  }

  function moveRow(key: string, dir: -1 | 1) {
    setSteps(prev => {
      const idx = prev.findIndex(s => s._tempKey === key);
      const tgt = idx + dir;
      if (idx < 0 || tgt < 0 || tgt >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[tgt]] = [next[tgt], next[idx]];
      return next.map((s, i) => ({ ...s, sort_order: i }));
    });
    setSaved(false);
  }

  async function save() {
    setError(null);
    // Light client-side validation — DB CHECK constraints catch the rest.
    for (const s of steps) {
      if (!s.department_id) { setError("Every step needs a department."); return; }
      if (!s.step_name.trim()) { setError("Every step needs a name."); return; }
      if (Number(s.people_count) <= 0) { setError(`"${s.step_name}": people must be > 0`); return; }
      if (Number(s.std_minutes)  <= 0) { setError(`"${s.step_name}": minutes must be > 0`); return; }
      if (Number(s.reference_qty) <= 0) { setError(`"${s.step_name}": ref qty must be > 0`); return; }
    }

    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not signed in"); setSaving(false); return; }
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user.id).single();
    if (!profile?.tenant_id) { setError("No tenant on profile"); setSaving(false); return; }

    // 1) Delete rows the user removed.
    if (deletedIds.length > 0) {
      const { error: delErr } = await supabase
        .from("production_routings")
        .delete()
        .in("id", deletedIds);
      if (delErr) { setError(`Delete failed: ${delErr.message}`); setSaving(false); return; }
    }

    // 2) Split into INSERTs (new rows, no id) and UPSERTs (existing rows by id).
    //    Tino May 2026: a combined `.upsert(payload, { onConflict: "id" })`
    //    fails for new rows because Supabase serialises id=null into the
    //    payload, which violates the NOT NULL constraint on the PK. The DB
    //    default `gen_random_uuid()` only fires when the column is omitted
    //    entirely, which happens when we insert without the id key.
    const rowFields = (s: typeof steps[number]) => ({
      tenant_id: profile.tenant_id,
      bom_header_id: bomHeaderId,
      department_id: s.department_id,
      step_name: s.step_name.trim(),
      people_count: Number(s.people_count),
      std_minutes:  Number(s.std_minutes),
      reference_qty: Number(s.reference_qty),
      reference_basis: s.reference_basis,
      sort_order: s.sort_order,
      notes: s.notes.trim() || null,
    });
    const insertRows = steps.filter(s => !s.id).map(rowFields);
    const updateRows = steps.filter(s => !!s.id).map(s => ({ id: s.id!, ...rowFields(s) }));

    if (insertRows.length > 0) {
      const { error: insErr } = await supabase
        .from("production_routings")
        .insert(insertRows);
      if (insErr) { setError(`Save failed (insert): ${insErr.message}`); setSaving(false); return; }
    }
    if (updateRows.length > 0) {
      const { error: upErr } = await supabase
        .from("production_routings")
        .upsert(updateRows, { onConflict: "id" });
      if (upErr) { setError(`Save failed (update): ${upErr.message}`); setSaving(false); return; }
    }

    setDeletedIds([]);
    setSaving(false);
    setSaved(true);
    router.refresh();
  }

  const rateMissing = currentHourlyRate == null || currentHourlyRate <= 0;

  return (
    <div>
      {/* Status bar */}
      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1rem", marginBottom: "0.75rem" }}>
        <div>
          <div style={{ fontSize: "0.7rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
            Hourly labour rate
          </div>
          <div style={{ fontSize: "1.1rem", fontFamily: "monospace", fontWeight: 700, color: rateMissing ? "#b91c1c" : "#1c1917" }}>
            {rateMissing ? (
              <a href="/costings/rates" style={{ color: "#b91c1c", textDecoration: "underline" }}>
                Not set — set it on /costings/rates
              </a>
            ) : (
              <>${(currentHourlyRate as number).toFixed(2)}/hr</>
            )}
          </div>
          {currentRateEffectiveFrom && !rateMissing && (
            <div style={{ fontSize: "0.7rem", color: "#a8a29e" }}>
              effective from <span style={{ fontFamily: "monospace" }}>{currentRateEffectiveFrom}</span>
            </div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "0.7rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
            Total labour
          </div>
          <div style={{ fontSize: "1.4rem", fontFamily: "monospace", fontWeight: 700, color: totals.total > 0 ? "#166534" : "#a8a29e" }}>
            {fmtMoney(totals.total)} <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "#78716c" }}>/kg of output</span>
          </div>
          {totals.uncomputable > 0 && (
            <div style={{ fontSize: "0.7rem", color: "#b91c1c" }}>
              {totals.uncomputable} step{totals.uncomputable === 1 ? "" : "s"} can&apos;t compute (missing pack data on this BOM&apos;s item)
            </div>
          )}
        </div>
      </div>

      {/* Error or saved toast */}
      {error && (
        <div style={{ padding: "0.5rem 0.75rem", marginBottom: "0.625rem", background: "#fee2e2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: "0.375rem", fontSize: "0.8125rem" }}>{error}</div>
      )}
      {saved && !error && (
        <div style={{ padding: "0.4rem 0.75rem", marginBottom: "0.625rem", background: "#dcfce7", border: "1px solid #bbf7d0", color: "#166534", borderRadius: "0.375rem", fontSize: "0.8125rem" }}>Saved.</div>
      )}

      {/* Editable table */}
      <table className="data-table" style={{ fontSize: "0.8125rem" }}>
        <thead>
          <tr>
            <th style={{ width: 60 }}>#</th>
            <th style={{ width: "14%" }}>Department</th>
            <th style={{ width: "18%" }}>Step</th>
            <th style={{ width: 90,  textAlign: "right" }} title="Number of people on this step">People</th>
            <th style={{ width: 90,  textAlign: "right" }} title="Standard minutes for the reference qty">Min</th>
            <th style={{ width: 36,  textAlign: "center", color: "#a8a29e" }}>per</th>
            <th style={{ width: 110, textAlign: "right" }} title="Reference quantity (e.g. 1000 if rate is per 1000 kg)">Ref qty</th>
            <th style={{ width: 110 }}>Basis</th>
            <th style={{ width: 110, textAlign: "right" }} title="Implied $/kg of BOM output">$/kg</th>
            <th>Notes</th>
            <th style={{ width: 90 }}></th>
          </tr>
        </thead>
        <tbody>
          {steps.length === 0 && (
            <tr>
              <td colSpan={11} style={{ textAlign: "center", padding: "1rem", color: "#a8a29e", fontStyle: "italic" }}>
                No routing steps yet. Click &quot;+ Add step&quot; below to start.
              </td>
            </tr>
          )}
          {steps.map((s, idx) => {
            const dpk = dollarsPerKg(s);
            const isLastRow = idx === steps.length - 1;
            return (
              <tr key={s._tempKey} data-row-key={s._tempKey}>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <button type="button" onClick={() => moveRow(s._tempKey, -1)} disabled={idx === 0} style={{ fontSize: "0.65rem", padding: "1px 4px", border: "1px solid #cfc9bf", background: "#fff", borderRadius: 3, cursor: idx === 0 ? "default" : "pointer" }}>▲</button>
                    <button type="button" onClick={() => moveRow(s._tempKey,  1)} disabled={idx === steps.length - 1} style={{ fontSize: "0.65rem", padding: "1px 4px", border: "1px solid #cfc9bf", background: "#fff", borderRadius: 3, cursor: idx === steps.length - 1 ? "default" : "pointer" }}>▼</button>
                  </div>
                </td>
                <td>
                  <select
                    className="form-select"
                    value={s.department_id}
                    onChange={e => update(s._tempKey, { department_id: e.target.value })}
                    style={{ fontSize: "0.8125rem" }}
                    data-first-field
                  >
                    <option value="">— pick —</option>
                    {deptOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </td>
                <td>
                  <input className="form-input" placeholder="e.g. Filling" value={s.step_name} onChange={e => update(s._tempKey, { step_name: e.target.value })} style={{ fontSize: "0.8125rem", width: "100%" }} />
                </td>
                <td>
                  <input className="form-input" type="text" inputMode="decimal" pattern="[0-9.]*" value={s.people_count} onChange={e => update(s._tempKey, { people_count: e.target.value })} style={{ fontSize: "0.8125rem", textAlign: "right", width: "100%", fontFamily: "monospace" }} />
                </td>
                <td>
                  <input className="form-input" type="text" inputMode="decimal" pattern="[0-9.]*" value={s.std_minutes} onChange={e => update(s._tempKey, { std_minutes: e.target.value })} style={{ fontSize: "0.8125rem", textAlign: "right", width: "100%", fontFamily: "monospace" }} />
                </td>
                <td style={{ textAlign: "center", color: "#a8a29e", fontSize: "0.75rem" }}>per</td>
                <td>
                  <input className="form-input" type="text" inputMode="decimal" pattern="[0-9.]*" value={s.reference_qty} onChange={e => update(s._tempKey, { reference_qty: e.target.value })} style={{ fontSize: "0.8125rem", textAlign: "right", width: "100%", fontFamily: "monospace" }} />
                </td>
                <td>
                  <select className="form-select" value={s.reference_basis} onChange={e => update(s._tempKey, { reference_basis: e.target.value as Basis })} style={{ fontSize: "0.8125rem" }}>
                    {BASIS_OPTIONS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                  </select>
                </td>
                <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: dpk == null ? "#b91c1c" : "#166534" }}>
                  {dpk == null ? (
                    <span title={rateMissing ? "Set hourly rate first" : "Set pack hierarchy on the BOM's item, or use 'kg' basis"}>—</span>
                  ) : fmtMoney(dpk)}
                </td>
                <td>
                  <input
                    className="form-input"
                    placeholder="optional"
                    value={s.notes}
                    onChange={e => update(s._tempKey, { notes: e.target.value })}
                    onKeyDown={e => onLastCellKeyDown(e, isLastRow)}
                    style={{ fontSize: "0.8125rem", width: "100%" }}
                  />
                </td>
                <td>
                  <button type="button" onClick={() => removeRow(s._tempKey)} style={{ background: "transparent", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: "0.3rem", padding: "0.2rem 0.5rem", cursor: "pointer", fontSize: "0.75rem" }} title="Remove this step">✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.625rem", alignItems: "center" }}>
        <button type="button" onClick={() => addRow()} className="btn-secondary">+ Add step</button>
        <button type="button" onClick={save} disabled={saving} className="btn-primary" style={{ marginLeft: "auto" }}>
          {saving ? "Saving…" : "Save routing"}
        </button>
      </div>

      {/* Per-dept breakdown */}
      {totals.byDept.size > 0 && (
        <div className="card" style={{ marginTop: "1rem", padding: "0.75rem 1rem" }}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 700 }}>Labour by department</h3>
          <table style={{ width: "100%", fontSize: "0.8125rem" }}>
            <tbody>
              {Array.from(totals.byDept.entries()).map(([dept, $]) => (
                <tr key={dept}>
                  <td style={{ padding: "0.2rem 0.4rem", color: "#57534e" }}>{dept}</td>
                  <td style={{ padding: "0.2rem 0.4rem", textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: "#166534", width: 140 }}>
                    {fmtMoney($)}<span style={{ color: "#78716c", fontWeight: 400, fontSize: "0.7rem" }}> /kg</span>
                  </td>
                  <td style={{ padding: "0.2rem 0.4rem", textAlign: "right", color: "#a8a29e", width: 60 }}>
                    {totals.total > 0 ? `${(($ / totals.total) * 100).toFixed(0)}%` : "—"}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid #1c1917" }}>
                <td style={{ padding: "0.4rem", fontWeight: 700 }}>Total</td>
                <td style={{ padding: "0.4rem", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "#166534" }}>
                  {fmtMoney(totals.total)}<span style={{ color: "#78716c", fontWeight: 400, fontSize: "0.7rem" }}> /kg</span>
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
