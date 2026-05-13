"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import CalcInput from "@/components/calc-input";

/**
 * Customer Price Overrides panel — admin/manager-gated section on the
 * customer detail page. Lets you set per-item prices that override the
 * customer's price group for specific items.
 *
 * Data: item_price_targets rows where scope_type='customer' and
 * scope_id = this customer.id (from mig 136). The trigger in 136 writes
 * to item_price_target_history on every change for audit.
 *
 * Override modes:
 *   - Margin %     — target_margin_pct set, target_sell_price NULL.
 *                    Price gets computed at order time as cost / (1 - m/100).
 *   - Fixed $/UOM  — target_sell_price + target_unit set. Overrides margin
 *                    even if both are present.
 */

const UOMS = ["kg", "ea", "inner", "outer", "pallet"] as const;
type Uom = typeof UOMS[number];

export type CustomerOverride = {
  id: string;
  item_id: string;
  target_margin_pct: number | string | null;
  target_sell_price: number | string | null;
  target_unit: Uom | string;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  updated_at: string;
  item: { id: string; code: string; name: string; unit: string; item_type: string } | null;
};

export type SimpleItem = {
  id: string;
  code: string;
  name: string;
  unit: string;
  item_type: string;
  weight_mode: string | null;
  target_weight_g: number | null;
};

const COMMON_REASONS = [
  "Negotiated rate",
  "Volume discount",
  "Promotional pricing",
  "Long-standing relationship",
  "Strategic account",
  "Other",
];

function fmt(n: number | string | null | undefined, dp = 2): string {
  if (n == null) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" });
}

export default function CustomerPriceOverridesPanel({
  customerId, customerName, initialOverrides, allItems,
}: {
  customerId: string;
  customerName: string;
  initialOverrides: CustomerOverride[];
  allItems: SimpleItem[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [overrides, setOverrides] = useState<CustomerOverride[]>(initialOverrides);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [itemId, setItemId] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [mode, setMode] = useState<"margin" | "fixed">("margin");
  const [marginPct, setMarginPct] = useState("");
  const [fixedPrice, setFixedPrice] = useState("");
  const [unit, setUnit] = useState<Uom>("kg");
  const [reason, setReason] = useState("Negotiated rate");
  const [reasonOther, setReasonOther] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openAdd() {
    setEditingId(null);
    setShowAdd(true);
    setItemId("");
    setItemSearch("");
    setMode("margin");
    setMarginPct("");
    setFixedPrice("");
    setUnit("kg");
    setReason("Negotiated rate");
    setReasonOther("");
    setError(null);
  }
  function openEdit(o: CustomerOverride) {
    setEditingId(o.id);
    setShowAdd(false);
    setItemId(o.item_id);
    setItemSearch("");
    if (o.target_sell_price != null) {
      setMode("fixed");
      setFixedPrice(String(o.target_sell_price));
      setMarginPct(o.target_margin_pct != null ? String(o.target_margin_pct) : "");
    } else {
      setMode("margin");
      setMarginPct(o.target_margin_pct != null ? String(o.target_margin_pct) : "");
      setFixedPrice("");
    }
    setUnit((o.target_unit as Uom) ?? "kg");
    setReason(o.notes ?? "Negotiated rate");
    setReasonOther("");
    setError(null);
  }
  function cancelForm() {
    setShowAdd(false);
    setEditingId(null);
    setError(null);
  }

  async function saveOverride() {
    const finalReason = reason === "Other" ? reasonOther.trim() : reason;
    if (!finalReason || finalReason.length < 3) {
      setError("Reason is required (min 3 chars) — written to audit log.");
      return;
    }
    if (showAdd && !itemId) {
      setError("Pick an item.");
      return;
    }
    const m = marginPct ? parseFloat(marginPct) : null;
    const f = fixedPrice ? parseFloat(fixedPrice) : null;
    if (mode === "margin") {
      if (m == null || !Number.isFinite(m) || m < 0 || m >= 100) {
        setError("Margin % must be a number from 0 to <100.");
        return;
      }
    } else {
      if (f == null || !Number.isFinite(f) || f < 0) {
        setError("Fixed price must be a number ≥ 0.");
        return;
      }
    }

    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {
      scope_type: "customer",
      scope_id: customerId,
      target_unit: unit,
      target_margin_pct: mode === "margin" ? m : (m ?? null),
      target_sell_price: mode === "fixed" ? f : null,
      notes: finalReason,
    };

    if (editingId) {
      const { error: e } = await supabase.from("item_price_targets").update(payload).eq("id", editingId);
      if (e) { setError(e.message); setSaving(false); return; }
    } else {
      payload.item_id = itemId;
      const { error: e } = await supabase.from("item_price_targets").insert(payload);
      if (e) { setError(e.message); setSaving(false); return; }
    }
    setSaving(false);
    cancelForm();
    router.refresh();
  }

  async function deleteOverride(id: string) {
    if (!confirm("Delete this customer override? The history audit row stays for traceability.")) return;
    const snapshot = overrides;
    setOverrides(prev => prev.filter(o => o.id !== id));
    const { error: e } = await supabase.from("item_price_targets").delete().eq("id", id);
    if (e) {
      setError(e.message);
      setOverrides(snapshot);
      return;
    }
    router.refresh();
  }

  // Item picker filter
  const usedItemIds = new Set(overrides.map(o => o.item_id));
  const availableItems = allItems
    .filter(i => editingId === null ? !usedItemIds.has(i.id) : true)
    .filter(i =>
      i.code.toLowerCase().includes(itemSearch.toLowerCase()) ||
      i.name.toLowerCase().includes(itemSearch.toLowerCase())
    );

  return (
    <div className="card" style={{ padding: 0, borderLeft: "3px solid #7e22ce" }}>
      <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>
            🎯 Customer-specific prices
            <span style={{ marginLeft: "0.5rem", fontSize: "0.65rem", color: "#78716c", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>admin view</span>
          </h2>
          <p style={{ fontSize: "0.75rem", color: "#78716c", margin: "0.25rem 0 0" }}>
            Per-item overrides that beat <strong>{customerName}</strong>&apos;s price group. Each change writes an audit row.
          </p>
        </div>
        {!showAdd && !editingId && (
          <button type="button" className="btn-primary" onClick={openAdd} style={{ fontSize: "0.8125rem" }}>+ Add Override</button>
        )}
      </div>

      {(showAdd || editingId) && (
        <div style={{ padding: "1rem 1.25rem", background: "#fafaf9", borderBottom: "1px solid #e7e5e4" }}>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
            {editingId ? "Edit override" : "Add override"}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
            {showAdd && (
              <div style={{ gridColumn: "1 / -1" }}>
                <label className="form-label">Item *</label>
                <input className="form-input" placeholder="Search by code or name…" value={itemSearch} onChange={e => setItemSearch(e.target.value)} style={{ marginBottom: "0.375rem" }} />
                <div style={{ border: "1px solid #e7e5e4", borderRadius: "0.375rem", maxHeight: "180px", overflowY: "auto", background: "#fff" }}>
                  {availableItems.length === 0 ? (
                    <div style={{ padding: "0.75rem", fontSize: "0.8125rem", color: "#a8a29e", textAlign: "center" }}>No items match.</div>
                  ) : availableItems.slice(0, 80).map(i => {
                    const sel = itemId === i.id;
                    return (
                      <button key={i.id} type="button" onClick={() => setItemId(i.id)} style={{ display: "flex", width: "100%", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0.625rem", border: "none", borderBottom: "1px solid #f5f5f4", textAlign: "left", cursor: "pointer", background: sel ? "#fef2f2" : "transparent", color: sel ? "#991b1b" : "#1c1917", fontWeight: sel ? 600 : 400, fontSize: "0.8125rem" }}>
                        {sel && <span style={{ color: "#b91c1c" }}>✓</span>}
                        <span style={{ fontFamily: "monospace", color: "#78716c", minWidth: "5rem", fontSize: "0.75rem" }}>{i.code}</span>
                        <span style={{ flex: 1 }}>{i.name}</span>
                        <span style={{ fontSize: "0.7rem", color: "#a8a29e" }}>{i.unit}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div>
              <label className="form-label">Override mode</label>
              <select className="form-select" value={mode} onChange={e => setMode(e.target.value as "margin" | "fixed")}>
                <option value="margin">Margin % (computed at order)</option>
                <option value="fixed">Fixed price (locked $/UOM)</option>
              </select>
            </div>
            <div>
              <label className="form-label">{mode === "margin" ? "Margin %" : "Fixed Price"}</label>
              {mode === "margin" ? (
                <CalcInput value={marginPct} onChange={setMarginPct} decimals={2} placeholder="e.g. 22.5" />
              ) : (
                <CalcInput value={fixedPrice} onChange={setFixedPrice} decimals={4} placeholder="0.00" />
              )}
            </div>
            <div>
              <label className="form-label">UOM</label>
              <select className="form-select" value={unit} onChange={e => setUnit(e.target.value as Uom)}>
                {UOMS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Reason *</label>
              <select className="form-select" value={reason} onChange={e => setReason(e.target.value)}>
                {COMMON_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            {reason === "Other" && (
              <div style={{ gridColumn: "1 / -1" }}>
                <input className="form-input" placeholder="Reason (will be audit-logged)" value={reasonOther} onChange={e => setReasonOther(e.target.value)} />
              </div>
            )}
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: "0.8125rem", margin: "0 0 0.5rem" }}>{error}</p>}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn-primary" onClick={saveOverride} disabled={saving} style={{ fontSize: "0.8125rem" }}>{saving ? "Saving…" : (editingId ? "Save Changes" : "Add Override")}</button>
            <button type="button" className="btn-secondary" onClick={cancelForm} style={{ fontSize: "0.8125rem" }}>Cancel</button>
          </div>
        </div>
      )}

      {overrides.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#78716c", fontSize: "0.875rem" }}>
          No customer-specific prices set. Click <strong>+ Add Override</strong> above to set one.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Mode</th>
              <th style={{ textAlign: "right" }}>Value</th>
              <th>UOM</th>
              <th>Reason / Notes</th>
              <th>Effective</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {overrides.map(o => {
              const isFixed = o.target_sell_price != null;
              return (
                <tr key={o.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{o.item?.name ?? "—"}</div>
                    <div style={{ fontSize: "0.75rem", color: "#78716c", fontFamily: "monospace" }}>{o.item?.code}</div>
                  </td>
                  <td>
                    <span style={{ fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", background: isFixed ? "#ede9fe" : "#dbeafe", color: isFixed ? "#6b21a8" : "#1e40af", borderRadius: "0.25rem", padding: "0.1rem 0.4rem" }}>
                      {isFixed ? "Fixed $" : "Margin %"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>
                    {isFixed
                      ? fmt(o.target_sell_price, 4)
                      : (o.target_margin_pct != null ? `${Number(o.target_margin_pct).toFixed(1)}%` : "—")}
                  </td>
                  <td style={{ color: "#78716c", fontSize: "0.8125rem" }}>{o.target_unit}</td>
                  <td style={{ fontSize: "0.8125rem", color: "#57534e" }}>{o.notes ?? "—"}</td>
                  <td style={{ fontSize: "0.75rem", color: "#78716c" }}>
                    {fmtDate(o.effective_from)}
                    {o.effective_to ? <> – {fmtDate(o.effective_to)}</> : ""}
                  </td>
                  <td style={{ fontSize: "0.75rem", color: "#a8a29e" }}>{fmtDate(o.updated_at)}</td>
                  <td>
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <button className="btn-secondary" style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem" }} onClick={() => openEdit(o)}>Edit</button>
                      <button onClick={() => deleteOverride(o.id)} style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem", background: "none", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#dc2626", cursor: "pointer" }}>Remove</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
