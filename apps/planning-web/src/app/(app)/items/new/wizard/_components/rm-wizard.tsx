"use client";

/**
 * Raw Material wizard.
 *
 * Five-step guided setup for items that get bought (raw materials,
 * packaging, consumables). Plain-language path through the gotchas
 * operators trip on:
 *   - Item type derived from a "what is it?" question, not jargon.
 *   - Consume UOM separated from purchase UOM, with conversion handling
 *     (the bag-of-25kg / IBC-of-1100kg case).
 *   - At least ONE supplier required — there is no "skip suppliers" path,
 *     because cost calculations need supplier prices to land properly.
 *   - Live cost preview reaffirming: standard cost = highest supplier
 *     price (safety-first for costing), POs default to cheapest/preferred.
 *
 * Saves a single items row + N supplier_items rows in series. After save
 * the user lands on the item detail page where they can add more
 * suppliers, allergens, spec docs, etc. via existing UI.
 */

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";
import { SearchableSelect } from "@/components/searchable-select";

type Room = { id: string; name: string; code: string | null };
type Supplier   = { id: string; name: string; code: string | null };
type UomDef     = { id: string; code: string; name: string; category: string | null };

type WhatIsIt = "ingredient" | "packaging" | "consumable";
type ConsumeUom = "kg" | "ea" | "litre" | "metre" | "roll" | "carton" | "other";

type SupplierLine = {
  rowId: number;
  supplierId: string;
  purchaseUom: string;            // e.g. "bag", "IBC", "kg", "carton"
  purchaseUomQty: string;          // e.g. "25" — 1 bag = 25 kg/ea
  unitPrice: string;               // price per purchase UOM
  currency: string;                // "AUD" default
  leadTimeDays: string;
  minOrderQty: string;
  isPreferred: boolean;
};

const STEPS = [
  { id: "basics",     label: "What is it?" },
  { id: "uom",        label: "How is it used?" },
  { id: "where",      label: "Where" },
  { id: "suppliers",  label: "Suppliers" },
  { id: "review",     label: "Review & save" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

// Map "what is it" → items.item_type
const ITEM_TYPE_FOR: Record<WhatIsIt, string> = {
  ingredient:  "raw_material",
  packaging:   "packaging",
  consumable:  "consumable",
};

const WHAT_OPTIONS: { val: WhatIsIt; title: string; sub: string; emoji: string }[] = [
  { val: "ingredient", title: "Food ingredient",          sub: "Goes into recipes — meat, dairy, grains, spices, liquids.",      emoji: "🌾" },
  { val: "packaging",  title: "Packaging material",       sub: "Used to package products — boxes, bags, films, labels, lids.",   emoji: "📦" },
  { val: "consumable", title: "Cleaning / consumable",    sub: "Supplies you use up — sanitiser, gloves, paper towels.",          emoji: "🧴" },
];

const UOM_OPTIONS: { val: ConsumeUom; title: string; sub: string }[] = [
  { val: "kg",     title: "By weight (kg)",      sub: "Most ingredients — meat, flour, oils, salt." },
  { val: "ea",     title: "By count (each)",      sub: "Discrete countable items — boxes, labels, lids." },
  { val: "litre",  title: "By volume (litres)",   sub: "Liquids measured by volume — vinegar, oil, milk." },
  { val: "metre",  title: "By length (metres)",   sub: "Films, casings, tape." },
  { val: "roll",   title: "By roll",              sub: "Roll-stock — film rolls, label rolls." },
  { val: "carton", title: "By carton",            sub: "Sold + consumed by full carton — casings, bottles in cartons." },
  { val: "other",  title: "Something else",       sub: "Pick a custom unit (e.g. sheet, pallet, drum)." },
];

export default function RmWizard({
  tenantId, rooms, suppliers, uoms,
}: {
  tenantId: string;
  rooms: Room[];
  suppliers: Supplier[];
  uoms: UomDef[];
}) {
  const router   = useRouter();
  const supabase = createClient();

  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx].id;

  // Form state
  const [whatIsIt, setWhatIsIt] = useState<WhatIsIt>("ingredient");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const [consumeUom, setConsumeUom] = useState<ConsumeUom>("kg");
  const [customUom, setCustomUom]   = useState("");

  const [roomName, setRoomName] = useState("");
  const [shelfLifeDays, setShelfLifeDays]   = useState("");
  const [keepsSafetyStock, setKeepsSafetyStock] = useState(false);
  const [minStock, setMinStock] = useState("");
  const [maxStock, setMaxStock] = useState("");

  const [supplierLines, setSupplierLines] = useState<SupplierLine[]>([
    {
      rowId: 1, supplierId: "", purchaseUom: "kg", purchaseUomQty: "1",
      unitPrice: "", currency: "AUD", leadTimeDays: "", minOrderQty: "",
      isPreferred: true,
    },
  ]);

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // Auto-suggest a code from the name
  useEffect(() => {
    if (code) return;
    const slug = name
      .trim().toUpperCase().replace(/[^A-Z0-9 ]+/g, "")
      .split(/\s+/).filter(Boolean)
      .map(w => w.slice(0, 4)).slice(0, 3).join("-");
    if (slug) setCode(slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // The effective consume UOM — for "other" we use the user's custom string
  const effectiveConsumeUom = consumeUom === "other" ? customUom.trim() : consumeUom;

  // Live cost preview from the supplier rows
  const costPreview = useMemo(() => {
    const validRows = supplierLines.filter(s =>
      s.supplierId && s.unitPrice && parseFloat(s.unitPrice) > 0
        && s.purchaseUomQty && parseFloat(s.purchaseUomQty) > 0
    );
    if (validRows.length === 0) return null;
    const costsPerConsumeUom = validRows.map(s => {
      const price = parseFloat(s.unitPrice);
      const qty   = parseFloat(s.purchaseUomQty);
      const supplierName = suppliers.find(sp => sp.id === s.supplierId)?.name ?? "—";
      return {
        supplier: supplierName,
        costPerConsume: qty > 0 ? price / qty : 0,
        purchasePrice: price,
        purchaseUom: s.purchaseUom,
        purchaseQty: qty,
        isPreferred: s.isPreferred,
      };
    });
    const max = Math.max(...costsPerConsumeUom.map(c => c.costPerConsume));
    const min = Math.min(...costsPerConsumeUom.map(c => c.costPerConsume));
    const cheapest = costsPerConsumeUom.find(c => c.costPerConsume === min);
    const preferred = costsPerConsumeUom.find(c => c.isPreferred);
    return { max, min, cheapest, preferred, rows: costsPerConsumeUom };
  }, [supplierLines, suppliers]);

  // Step validation
  const canProceed = useMemo(() => {
    if (step === "basics")    return name.trim().length > 0 && code.trim().length > 0;
    if (step === "uom")       return consumeUom !== "other" || customUom.trim().length > 0;
    if (step === "where")     return whatIsIt !== "ingredient" || roomName.trim().length > 0;
    if (step === "suppliers") {
      // At least one fully-filled supplier row, with all required fields
      const ok = supplierLines.filter(s =>
        s.supplierId && s.purchaseUom && s.purchaseUomQty && parseFloat(s.purchaseUomQty) > 0
        && s.unitPrice && parseFloat(s.unitPrice) > 0
      );
      return ok.length >= 1;
    }
    if (step === "review")    return !saving;
    return false;
  }, [step, name, code, consumeUom, customUom, whatIsIt, roomName, supplierLines, saving]);

  function next() {
    setError(null);
    // If user is leaving "basics" without a code, auto-generate one — never let them
    // hit a downstream step (or the save) with an empty code.
    if (step === "basics" && !code.trim()) {
      const slugFromName = name.trim().toUpperCase().replace(/[^A-Z0-9 ]+/g, "")
        .split(/\s+/).filter(Boolean).map(w => w.slice(0, 4)).slice(0, 3).join("-");
      const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
      const fallback = (slugFromName || "ITEM") + "-" + suffix;
      setCode(fallback);
    }
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

  function addSupplierRow() {
    const nextRowId = (supplierLines[supplierLines.length - 1]?.rowId ?? 0) + 1;
    setSupplierLines([...supplierLines, {
      rowId: nextRowId, supplierId: "", purchaseUom: effectiveConsumeUom || "kg",
      purchaseUomQty: "1", unitPrice: "", currency: "AUD",
      leadTimeDays: "", minOrderQty: "", isPreferred: false,
    }]);
  }
  function removeSupplierRow(rowId: number) {
    setSupplierLines(supplierLines.filter(s => s.rowId !== rowId));
  }
  function updateSupplierRow(rowId: number, patch: Partial<SupplierLine>) {
    setSupplierLines(supplierLines.map(s => s.rowId === rowId ? { ...s, ...patch } : s));
  }
  function setPreferred(rowId: number) {
    // Toggle: at most one preferred at a time, but the user can untick it.
    // If the row clicked is already preferred, clear it (no preferred → POs default to cheapest).
    setSupplierLines(supplierLines.map(s => {
      if (s.rowId === rowId) return { ...s, isPreferred: !s.isPreferred };
      return { ...s, isPreferred: false };
    }));
  }

  async function save() {
    setSaving(true);
    setError(null);

    // Build the items payload
    const itemPayload = {
      tenant_id:     tenantId,
      code:          code.trim(),
      name:          name.trim(),
      item_type:     ITEM_TYPE_FOR[whatIsIt],
      unit:          effectiveConsumeUom,
      // RMs intentionally do NOT set items.department — that field
      // is for produced items and would confuse demand planning.
      department:    null,
      room:          roomName.trim() || null,
      procurement_type: "purchase",
      is_active:     true,
      current_stock: 0,
      min_stock:     keepsSafetyStock && minStock ? parseFloat(minStock) : 0,
      max_stock:     keepsSafetyStock && maxStock ? parseFloat(maxStock) : 0,
      priority:      5,
    };

    const { data: itemRow, error: itemErr } = await supabase
      .from("items").insert(itemPayload).select("id").single();
    if (itemErr) {
      setSaving(false);
      setError("Item insert failed: " + itemErr.message);
      return;
    }
    const itemId = (itemRow as { id: string }).id;

    // Build supplier_items payload — only valid rows
    const validRows = supplierLines.filter(s =>
      s.supplierId && s.purchaseUom && s.purchaseUomQty && parseFloat(s.purchaseUomQty) > 0
      && s.unitPrice && parseFloat(s.unitPrice) > 0
    );
    if (validRows.length === 0) {
      setSaving(false);
      setError("No valid supplier rows found.");
      return;
    }

    const supPayloads = validRows.map(s => ({
      tenant_id:        tenantId,
      item_id:          itemId,
      supplier_id:      s.supplierId,
      unit_price:       parseFloat(s.unitPrice),
      currency:         s.currency || "AUD",
      purchase_uom:     s.purchaseUom,
      purchase_uom_qty: parseFloat(s.purchaseUomQty),
      lead_time_days:   s.leadTimeDays ? parseInt(s.leadTimeDays) : null,
      min_order_qty:    s.minOrderQty ? parseFloat(s.minOrderQty) : null,
      is_preferred:     s.isPreferred,
    }));

    const { error: supErr } = await supabase.from("supplier_items").insert(supPayloads);
    if (supErr) {
      setSaving(false);
      setError("Supplier links failed: " + supErr.message + " (item was created — you can add suppliers from the detail page)");
      router.push(`/items/${itemId}?just_created=1`);
      return;
    }
    setSaving(false);
    router.push(`/items/${itemId}?just_created=1`);
  }

  // ─── Render ───────────────────────────────────────────────
  return (
    <div style={{ maxWidth: "880px" }}>
      <BackButton href="/items/new/start" label="Pick type" />

      <div className="page-header">
        <div>
          <h1 className="page-title">Add a raw material / supply</h1>
          <p className="page-subtitle">
            For things you buy and use as input — ingredients, packaging, cleaning supplies.{" "}
            <Link href="/items/new/start" style={{ color: "#b91c1c", textDecoration: "none", fontWeight: 600 }}>
              Change type ↺
            </Link>
          </p>
        </div>
        <Link href="/items/new" className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
          Skip — open classic form
        </Link>
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
        {/* ─── Step 1: Basics + what is it ─── */}
        {step === "basics" && (
          <>
            <h2 style={{ fontSize: "1.125rem", margin: "0 0 0.4rem" }}>What is it?</h2>
            <p className="subtle" style={{ margin: "0 0 1.25rem" }}>
              We'll use this to set the right item type behind the scenes — you don't need to
              think about <span style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>raw_material</span>{" "}
              vs <span style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>packaging</span> categories.
            </p>

            {WHAT_OPTIONS.map(opt => (
              <label
                key={opt.val}
                style={{
                  display: "flex", gap: "0.75rem", alignItems: "flex-start",
                  padding: "0.75rem 0.875rem",
                  border: `1px solid ${whatIsIt === opt.val ? "#b91c1c" : "#e7e5e4"}`,
                  background: whatIsIt === opt.val ? "#fef2f2" : "white",
                  borderRadius: "0.5rem",
                  marginBottom: "0.5rem", cursor: "pointer",
                }}
              >
                <input
                  type="radio" name="whatIsIt" value={opt.val}
                  checked={whatIsIt === opt.val}
                  onChange={() => setWhatIsIt(opt.val)}
                  style={{ marginTop: "0.2rem" }}
                />
                <span style={{ fontSize: "1.5rem", lineHeight: 1, flexShrink: 0 }}>{opt.emoji}</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{opt.title}</div>
                  <div style={{ fontSize: "0.75rem", color: "#78716c" }}>{opt.sub}</div>
                </div>
              </label>
            ))}

            <hr style={{ margin: "1.5rem 0", border: 0, borderTop: "1px solid #e7e5e4" }} />

            <label className="form-label">Name *</label>
            <input
              className="form-input" autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={
                whatIsIt === "ingredient" ? "e.g. Pork 75CL" :
                whatIsIt === "packaging"  ? "e.g. Vacuum bag 200×300mm" :
                                            "e.g. Sanitiser 5L"
              }
            />
            <label className="form-label" style={{ marginTop: "1rem" }}>Item code *</label>
            <input
              className="form-input"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="auto-suggested"
              style={{ fontFamily: "monospace" }}
            />
          </>
        )}

        {/* ─── Step 2: How is it used (consume UOM) ─── */}
        {step === "uom" && (
          <>
            <h2 style={{ fontSize: "1.125rem", margin: "0 0 0.4rem" }}>How is it used in your recipes?</h2>
            <p className="subtle" style={{ margin: "0 0 1.25rem" }}>
              Pick how you measure it when it goes <em>into</em> a product. We'll handle the
              "but I buy it as a 25 kg bag" part separately on the supplier step.
            </p>

            {UOM_OPTIONS.map(opt => (
              <label
                key={opt.val}
                style={{
                  display: "flex", gap: "0.625rem", alignItems: "flex-start",
                  padding: "0.625rem 0.875rem",
                  border: `1px solid ${consumeUom === opt.val ? "#b91c1c" : "#e7e5e4"}`,
                  background: consumeUom === opt.val ? "#fef2f2" : "white",
                  borderRadius: "0.5rem",
                  marginBottom: "0.4rem", cursor: "pointer",
                }}
              >
                <input
                  type="radio" name="uom" value={opt.val}
                  checked={consumeUom === opt.val}
                  onChange={() => setConsumeUom(opt.val)}
                  style={{ marginTop: "0.2rem" }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{opt.title}</div>
                  <div style={{ fontSize: "0.75rem", color: "#78716c" }}>{opt.sub}</div>
                </div>
              </label>
            ))}

            {consumeUom === "other" && (
              <div style={{ marginTop: "0.75rem" }}>
                <label className="form-label">Custom unit *</label>
                <input
                  className="form-input"
                  value={customUom}
                  onChange={e => setCustomUom(e.target.value.toLowerCase())}
                  placeholder="e.g. sheet, drum, pallet"
                  style={{ maxWidth: "240px" }}
                />
              </div>
            )}
          </>
        )}

        {/* ─── Step 3: Where (storage room, not department) ─── */}
        {step === "where" && (
          <>
            <h2 style={{ fontSize: "1.125rem", margin: "0 0 0.4rem" }}>Where is it stored?</h2>
            <p className="subtle" style={{ margin: "0 0 1.25rem" }}>
              Pick the storage room or location. Raw materials don't belong to a production
              department — that's for items you make in-house. Storage location is what
              matters for finding it on the floor.
            </p>

            <label className="form-label">
              Storage room {whatIsIt === "ingredient" && "*"}
            </label>
            <select
              className="form-input"
              value={roomName}
              onChange={e => setRoomName(e.target.value)}
              style={{ maxWidth: "360px" }}
            >
              <option value="">— pick a room —</option>
              {rooms.map(r => (
                <option key={r.id} value={r.name}>{r.name}{r.code ? ` (${r.code})` : ""}</option>
              ))}
            </select>
            <p style={{ fontSize: "0.7rem", color: "#a8a29e", margin: "0.25rem 0 0" }}>
              Don't see the right room? Settings → Rooms to add one.
            </p>

            <label className="form-label" style={{ marginTop: "1rem" }}>Shelf life (days)</label>
            <input
              className="form-input" type="number" min="0"
              value={shelfLifeDays}
              onChange={e => setShelfLifeDays(e.target.value)}
              placeholder="optional"
              style={{ maxWidth: "200px" }}
            />

            <hr style={{ margin: "1.5rem 0", border: 0, borderTop: "1px solid #e7e5e4" }} />

            <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, margin: "0 0 0.4rem" }}>Stock control</h3>
            <p className="subtle" style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem" }}>
              Skip if you order this item per demand only. Set min / max if you keep safety
              stock — Tracey will flag low-stock alerts and use max as the reorder target.
            </p>

            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer", marginBottom: "0.625rem" }}>
              <input
                type="checkbox"
                checked={keepsSafetyStock}
                onChange={e => setKeepsSafetyStock(e.target.checked)}
              />
              I keep safety stock of this item (set min / max)
            </label>

            {keepsSafetyStock && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", maxWidth: "440px" }}>
                <div>
                  <label className="form-label" style={{ fontSize: "0.75rem" }}>Min stock ({effectiveConsumeUom || "unit"})</label>
                  <input
                    className="form-input" type="number" step="0.01" min="0"
                    value={minStock}
                    onChange={e => setMinStock(e.target.value)}
                    placeholder="reorder threshold"
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: "0.75rem" }}>Max stock ({effectiveConsumeUom || "unit"})</label>
                  <input
                    className="form-input" type="number" step="0.01" min="0"
                    value={maxStock}
                    onChange={e => setMaxStock(e.target.value)}
                    placeholder="reorder target"
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* ─── Step 4: Suppliers ─── */}
        {step === "suppliers" && (
          <>
            <h2 style={{ fontSize: "1.125rem", margin: "0 0 0.4rem" }}>Who do you buy it from?</h2>
            <p className="subtle" style={{ margin: "0 0 1rem" }}>
              At least one supplier is required — costing math depends on this. Add as many as you like.
            </p>

            <div style={{
              padding: "0.75rem 1rem", marginBottom: "1rem",
              background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "0.5rem",
              fontSize: "0.8125rem", color: "#713f12",
            }}>
              <strong>Costing logic:</strong> standard cost (used for margin / stock value) defaults to the
              <strong> highest </strong>supplier price — that's the conservative number for any cost calc.
              When generating a PO, Tracey suggests the <strong>cheapest</strong> price (or the
              one you mark <strong>Preferred</strong>). You'll never accidentally under-cost a recipe.
            </div>

            {supplierLines.map((s, idx) => (
              <div
                key={s.rowId}
                style={{
                  border: "1px solid #e7e5e4",
                  background: s.isPreferred ? "#fef2f2" : "white",
                  borderRadius: "0.5rem", padding: "0.875rem", marginBottom: "0.75rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <strong style={{ fontSize: "0.8125rem" }}>
                    Supplier {idx + 1}
                    {s.isPreferred && <span style={{ marginLeft: "0.5rem", fontSize: "0.6875rem", color: "#b91c1c" }}>★ Preferred</span>}
                  </strong>
                  {supplierLines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSupplierRow(s.rowId)}
                      style={{
                        border: "1px solid #fca5a5", background: "transparent", color: "#dc2626",
                        borderRadius: "0.25rem", padding: "0.125rem 0.5rem",
                        fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit",
                      }}
                    >Remove</button>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "0.625rem", marginBottom: "0.625rem" }}>
                  <div>
                    <label className="form-label" style={{ fontSize: "0.6875rem" }}>Supplier *</label>
                    <SearchableSelect
                      value={s.supplierId}
                      onChange={v => updateSupplierRow(s.rowId, { supplierId: v })}
                      options={suppliers.map(sup => ({
                        value: sup.id,
                        label: sup.code ? `${sup.name} (${sup.code})` : sup.name,
                      }))}
                      placeholder="Search suppliers…"
                      addNew={{
                        table: "suppliers",
                        labelField: "name",
                        codeField: "code",
                        dialogTitle: "New supplier",
                        extras: { tenant_id: tenantId, is_active: true },
                        onCreated: () => {
                          // Fresh list lands on next page load; for now, the inserted
                          // row is selected via SearchableSelect's own state.
                        },
                      }}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: "0.6875rem" }}>Purchase UOM *</label>
                    <SearchableSelect
                      value={s.purchaseUom}
                      onChange={v => updateSupplierRow(s.rowId, { purchaseUom: v })}
                      options={uoms.map(u => ({
                        value: u.code,
                        label: `${u.code}${u.name && u.name !== u.code ? ` — ${u.name}` : ""}`,
                      }))}
                      placeholder={effectiveConsumeUom || "kg"}
                      addNew={{
                        table: "units_of_measure",
                        labelField: "name",
                        codeField: "code",
                        dialogTitle: "New unit of measure",
                        extras: { tenant_id: tenantId, is_active: true, category: "purchasing" },
                      }}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: "0.6875rem" }}>= how many {effectiveConsumeUom || "consume units"} *</label>
                    <input
                      className="form-input" type="number" step="0.001" min="0"
                      value={s.purchaseUomQty}
                      onChange={e => updateSupplierRow(s.rowId, { purchaseUomQty: e.target.value })}
                      placeholder="e.g. 25"
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: "0.6875rem" }}>Price per {s.purchaseUom || "UOM"} *</label>
                    <input
                      className="form-input" type="number" step="0.01" min="0"
                      value={s.unitPrice}
                      onChange={e => updateSupplierRow(s.rowId, { unitPrice: e.target.value })}
                      placeholder="e.g. 47.50"
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.625rem" }}>
                  <div>
                    <label className="form-label" style={{ fontSize: "0.6875rem" }}>Currency</label>
                    <input
                      className="form-input"
                      value={s.currency}
                      onChange={e => updateSupplierRow(s.rowId, { currency: e.target.value.toUpperCase() })}
                      placeholder="AUD"
                      style={{ fontFamily: "monospace", maxWidth: "100%" }}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: "0.6875rem" }}>Lead time (days)</label>
                    <input
                      className="form-input" type="number" min="0"
                      value={s.leadTimeDays}
                      onChange={e => updateSupplierRow(s.rowId, { leadTimeDays: e.target.value })}
                      placeholder="e.g. 3"
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: "0.6875rem" }}>Min order qty</label>
                    <input
                      className="form-input" type="number" step="0.01" min="0"
                      value={s.minOrderQty}
                      onChange={e => updateSupplierRow(s.rowId, { minOrderQty: e.target.value })}
                      placeholder="optional"
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", cursor: "pointer", marginBottom: "0.4rem" }}>
                      <input
                        type="checkbox"
                        checked={s.isPreferred}
                        onChange={() => setPreferred(s.rowId)}
                      />
                      Preferred
                    </label>
                    <span style={{ fontSize: "0.6rem", color: "#a8a29e" }}>
                      {s.isPreferred ? "Click again to untick" : "Untick = POs go cheapest"}
                    </span>
                  </div>
                </div>

                {s.unitPrice && s.purchaseUomQty && parseFloat(s.purchaseUomQty) > 0 && (
                  <div style={{ marginTop: "0.625rem", padding: "0.4rem 0.625rem", background: "#fafaf9", borderRadius: "0.25rem", fontSize: "0.75rem", color: "#57534e" }}>
                    = <strong>${(parseFloat(s.unitPrice) / parseFloat(s.purchaseUomQty)).toFixed(4)}</strong>{" "}
                    per {effectiveConsumeUom || "consume unit"}
                  </div>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={addSupplierRow}
              style={{
                width: "100%", padding: "0.625rem",
                border: "2px dashed #cfc9bf", background: "transparent",
                borderRadius: "0.5rem", color: "#78716c", cursor: "pointer",
                fontSize: "0.8125rem", fontFamily: "inherit",
              }}
            >+ Add another supplier</button>

            {/* ─── Live cost summary ─── */}
            {costPreview && (
              <div style={{ marginTop: "1rem", padding: "0.875rem 1rem", background: "#dcfce7", border: "1px solid #86efac", borderRadius: "0.5rem", fontSize: "0.8125rem", color: "#166534" }}>
                <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                  ✓ With these prices, Tracey will set:
                </div>
                <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem", lineHeight: 1.6 }}>
                  <li><strong>Standard cost</strong> = ${costPreview.max.toFixed(4)} per {effectiveConsumeUom || "unit"} <span style={{ color: "#15803d" }}>(highest — conservative for costing)</span></li>
                  <li><strong>POs default to</strong> {costPreview.preferred?.supplier ?? costPreview.cheapest?.supplier} at ${(costPreview.preferred?.costPerConsume ?? costPreview.cheapest?.costPerConsume ?? 0).toFixed(4)} per {effectiveConsumeUom || "unit"}</li>
                </ul>
              </div>
            )}
          </>
        )}

        {/* ─── Step 5: Review ─── */}
        {step === "review" && (
          <>
            <h2 style={{ fontSize: "1.125rem", margin: "0 0 0.4rem" }}>Looks right?</h2>
            <p className="subtle" style={{ margin: "0 0 1.25rem" }}>
              All fields can be edited later from the item detail page.
            </p>

            <table className="data-table" style={{ fontSize: "0.875rem" }}>
              <tbody>
                <tr><td style={{ width: "200px", color: "#78716c" }}>Name</td><td><strong>{name}</strong></td></tr>
                <tr><td style={{ color: "#78716c" }}>Code</td><td style={{ fontFamily: "monospace" }}>{code}</td></tr>
                <tr><td style={{ color: "#78716c" }}>What kind</td><td>{WHAT_OPTIONS.find(o => o.val === whatIsIt)?.title} <span style={{ color: "#a8a29e", fontFamily: "monospace", fontSize: "0.75rem" }}>(item_type = {ITEM_TYPE_FOR[whatIsIt]})</span></td></tr>
                <tr><td style={{ color: "#78716c" }}>Used as</td><td>{effectiveConsumeUom || "—"}</td></tr>
                <tr><td style={{ color: "#78716c" }}>Storage room</td><td>{roomName || <span style={{ color: "#a8a29e" }}>—</span>}</td></tr>
                <tr><td style={{ color: "#78716c" }}>Shelf life</td><td>{shelfLifeDays ? `${shelfLifeDays} days` : <span style={{ color: "#a8a29e" }}>—</span>}</td></tr>
                <tr><td style={{ color: "#78716c" }}>Stock control</td><td>{
                  keepsSafetyStock && (minStock || maxStock)
                    ? `min ${minStock || "0"} · max ${maxStock || "0"} ${effectiveConsumeUom}`
                    : <span style={{ color: "#a8a29e" }}>Order per demand (no safety stock)</span>
                }</td></tr>
                <tr><td style={{ color: "#78716c" }}>Suppliers</td><td>
                  {supplierLines
                    .filter(s => s.supplierId)
                    .map(s => {
                      const supName = suppliers.find(sup => sup.id === s.supplierId)?.name ?? "?";
                      const conv = (s.purchaseUomQty && parseFloat(s.purchaseUomQty) !== 1)
                        ? ` (1 ${s.purchaseUom} = ${s.purchaseUomQty} ${effectiveConsumeUom})`
                        : "";
                      return (
                        <div key={s.rowId}>
                          {s.isPreferred && <span style={{ color: "#b91c1c", marginRight: "0.25rem" }}>★</span>}
                          {supName} — ${s.unitPrice}/{s.purchaseUom}{conv}
                        </div>
                      );
                    })
                  }
                </td></tr>
                {costPreview && (
                  <>
                    <tr><td style={{ color: "#78716c" }}>Standard cost (derived)</td><td><strong>${costPreview.max.toFixed(4)}</strong> per {effectiveConsumeUom}</td></tr>
                    <tr><td style={{ color: "#78716c" }}>PO default supplier</td><td>{costPreview.preferred?.supplier ?? costPreview.cheapest?.supplier}</td></tr>
                  </>
                )}
              </tbody>
            </table>

            {/* ─── Where the data lands ─── */}
            <div style={{
              marginTop: "1rem", padding: "0.75rem 1rem",
              background: "#eff6ff", border: "1px solid #93c5fd",
              borderRadius: "0.5rem", fontSize: "0.8125rem", color: "#1e3a8a",
            }}>
              <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>How this saves</div>
              <ul style={{ margin: 0, paddingLeft: "1.25rem", lineHeight: 1.7 }}>
                <li>Each supplier above becomes a row in the item's <strong>Suppliers panel</strong> (right where you'd expect it).</li>
                <li>The <strong>Standard cost</strong> field is <em>not</em> written by this wizard. It's derived live from <span style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>v_item_cost_health</span> as the highest supplier price — so adding/removing suppliers later updates it automatically.</li>
                <li>POs default to the supplier you marked <strong>Preferred</strong>; if none is preferred, the cheapest wins.</li>
              </ul>
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
          <button type="button" onClick={save} disabled={saving} className="btn-primary" style={{ minWidth: "180px" }}>
            {saving ? "Saving…" : "✓ Create item + supplier links"}
          </button>
        )}
      </div>
    </div>
  );
}
