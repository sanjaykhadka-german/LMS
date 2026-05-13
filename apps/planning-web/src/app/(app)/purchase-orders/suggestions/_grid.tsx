"use client";

/**
 * PO Suggestions Grid (Phase 9.5 — Tino May 2026)
 *
 * Per-item rows with one or more *allocations* (a supplier + qty pair).
 * The default allocation is the cheapest supplier with the recommended
 * qty. The buyer can:
 *   • change the supplier on an allocation (dropdown auto-updates the
 *     unit price + currency from supplier_items)
 *   • change the qty
 *   • add another allocation row to split across suppliers
 *   • remove an allocation
 *
 * Per-row checkbox + bulk "Create draft POs" button at the bottom that
 * groups allocations across all selected items by supplier and creates
 * one draft PO per supplier.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDraftPosFromAllocations } from "../actions";

export type SuggestionRow = {
  item_id: string;
  item_code: string;
  item_name: string;
  item_unit: string;
  item_type: string;
  current_stock: number;
  min_stock: number;
  max_stock: number;
  plan_required: number;
  plan_to_order: number;
  earliest_needed_date: string | null;
  trigger_min: boolean;
  trigger_plan: boolean;
  trigger_lead_time: boolean;
  recommended_qty: number;
  cheapest_supplier_id: string | null;
  cheapest_supplier_name: string | null;
  cheapest_supplier_unit_price: number | null;
  cheapest_supplier_currency: string | null;
  cheapest_supplier_purchase_uom: string | null;
  cheapest_supplier_purchase_uom_qty: number | null;
  cheapest_supplier_lead_time_days: number | null;
  cheapest_supplier_min_order_qty: number | null;
};

export type SupplierLite = { id: string; name: string; code: string | null };
export type SupplierItemLite = {
  id: string;
  item_id: string;
  supplier_id: string;
  unit_price: number | null;
  currency: string | null;
  purchase_uom: string | null;
  purchase_uom_qty: number | null;
  lead_time_days: number | null;
  min_order_qty: number | null;
};

type Allocation = {
  id: string;             // local UUID for the row
  supplier_id: string;
  supplier_item_id: string | null;
  qty: string;
  unit: string;
  unit_price: string;
  currency: string;
  lead_time_days: number | null;
  min_order_qty: number | null;
};

type ItemState = {
  selected: boolean;
  allocations: Allocation[];
};

function uid() { return Math.random().toString(36).slice(2, 10); }

function fmtQty(v: number | string) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10)  return n.toFixed(1);
  return n.toFixed(2);
}
function fmtMoney(v: number) {
  return v.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 });
}

export function PoSuggestionsGrid({
  planId,
  rows,
  suppliers,
  supplierItems,
}: {
  planId: string;
  rows: SuggestionRow[];
  suppliers: SupplierLite[];
  supplierItems: SupplierItemLite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [bannerMsg, setBannerMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Index supplier_items by item for fast lookup
  const siByItem = useMemo(() => {
    const m = new Map<string, SupplierItemLite[]>();
    for (const si of supplierItems) {
      const arr = m.get(si.item_id) ?? [];
      arr.push(si);
      m.set(si.item_id, arr);
    }
    return m;
  }, [supplierItems]);

  // Initial state — default allocation per row
  const [state, setState] = useState<Record<string, ItemState>>(() => {
    const out: Record<string, ItemState> = {};
    for (const r of rows) {
      const si = (siByItem.get(r.item_id) ?? []).find(x => x.supplier_id === r.cheapest_supplier_id);
      out[r.item_id] = {
        selected: r.recommended_qty > 0 && !!r.cheapest_supplier_id,
        allocations: [{
          id: uid(),
          supplier_id: r.cheapest_supplier_id ?? "",
          supplier_item_id: si?.id ?? null,
          qty: r.recommended_qty > 0 ? String(Math.round(r.recommended_qty * 100) / 100) : "",
          unit: si?.purchase_uom ?? r.item_unit ?? "ea",
          unit_price: r.cheapest_supplier_unit_price != null ? String(r.cheapest_supplier_unit_price) : "",
          currency: r.cheapest_supplier_currency ?? "AUD",
          lead_time_days: r.cheapest_supplier_lead_time_days,
          min_order_qty: r.cheapest_supplier_min_order_qty,
        }],
      };
    }
    return out;
  });

  function setItemSelected(itemId: string, selected: boolean) {
    setState(prev => ({ ...prev, [itemId]: { ...prev[itemId], selected } }));
  }
  function updateAllocation(itemId: string, allocId: string, patch: Partial<Allocation>) {
    setState(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        allocations: prev[itemId].allocations.map(a => a.id === allocId ? { ...a, ...patch } : a),
      },
    }));
  }
  function changeAllocationSupplier(itemId: string, allocId: string, supplierId: string) {
    const si = (siByItem.get(itemId) ?? []).find(x => x.supplier_id === supplierId);
    updateAllocation(itemId, allocId, {
      supplier_id: supplierId,
      supplier_item_id: si?.id ?? null,
      unit_price: si?.unit_price != null ? String(si.unit_price) : "",
      currency: si?.currency ?? "AUD",
      unit: si?.purchase_uom ?? rows.find(r => r.item_id === itemId)?.item_unit ?? "ea",
      lead_time_days: si?.lead_time_days ?? null,
      min_order_qty: si?.min_order_qty ?? null,
    });
  }
  function addSplit(itemId: string) {
    setState(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        allocations: [
          ...prev[itemId].allocations,
          { id: uid(), supplier_id: "", supplier_item_id: null, qty: "", unit: "ea", unit_price: "", currency: "AUD", lead_time_days: null, min_order_qty: null },
        ],
      },
    }));
  }
  function removeAllocation(itemId: string, allocId: string) {
    setState(prev => {
      const cur = prev[itemId];
      if (!cur || cur.allocations.length <= 1) return prev;
      return { ...prev, [itemId]: { ...cur, allocations: cur.allocations.filter(a => a.id !== allocId) } };
    });
  }
  function resetItem(itemId: string) {
    const r = rows.find(x => x.item_id === itemId);
    if (!r) return;
    const si = (siByItem.get(r.item_id) ?? []).find(x => x.supplier_id === r.cheapest_supplier_id);
    setState(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        allocations: [{
          id: uid(),
          supplier_id: r.cheapest_supplier_id ?? "",
          supplier_item_id: si?.id ?? null,
          qty: r.recommended_qty > 0 ? String(Math.round(r.recommended_qty * 100) / 100) : "",
          unit: si?.purchase_uom ?? r.item_unit ?? "ea",
          unit_price: r.cheapest_supplier_unit_price != null ? String(r.cheapest_supplier_unit_price) : "",
          currency: r.cheapest_supplier_currency ?? "AUD",
          lead_time_days: r.cheapest_supplier_lead_time_days,
          min_order_qty: r.cheapest_supplier_min_order_qty,
        }],
      },
    }));
  }

  function selectAll() {
    setState(prev => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, selected: true }])));
  }
  function selectNone() {
    setState(prev => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, selected: false }])));
  }

  // ── Submit: gather allocations and call the server action ─────────────
  const selectedAllocations = useMemo(() => {
    const out: Array<{ item_id: string; supplier_id: string; supplier_item_id: string | null; qty: number; unit: string; unit_price: number | null; currency: string }> = [];
    for (const r of rows) {
      const s = state[r.item_id];
      if (!s?.selected) continue;
      for (const a of s.allocations) {
        const qty = parseFloat(a.qty);
        if (!a.supplier_id || !Number.isFinite(qty) || qty <= 0) continue;
        out.push({
          item_id: r.item_id,
          supplier_id: a.supplier_id,
          supplier_item_id: a.supplier_item_id,
          qty,
          unit: a.unit,
          unit_price: a.unit_price ? parseFloat(a.unit_price) : null,
          currency: a.currency || "AUD",
        });
      }
    }
    return out;
  }, [rows, state]);

  const distinctSuppliers = new Set(selectedAllocations.map(a => a.supplier_id)).size;
  const allocatedValue = selectedAllocations.reduce((s, a) => s + (a.qty * (a.unit_price ?? 0)), 0);

  function submit() {
    setBannerMsg(null);
    if (selectedAllocations.length === 0) {
      setBannerMsg({ kind: "err", text: "Select at least one item with a supplier and qty > 0." });
      return;
    }
    startTransition(async () => {
      const res = await createDraftPosFromAllocations({
        planId,
        allocations: selectedAllocations,
      });
      if (!res.ok) {
        setBannerMsg({ kind: "err", text: res.error ?? "Failed to create draft POs." });
        return;
      }
      const created = res.created ?? [];
      setBannerMsg({
        kind: "ok",
        text: `Created ${created.length} draft PO${created.length === 1 ? "" : "s"} (${created.map(c => `${c.poNumber} → ${c.supplierName}`).join(", ")}).`,
      });
      router.refresh();
    });
  }

  return (
    <>
      {bannerMsg && (
        <div style={{
          marginBottom: "0.875rem", padding: "0.625rem 0.875rem", borderRadius: "0.5rem",
          background: bannerMsg.kind === "ok" ? "#dcfce7" : "#fee2e2",
          color:      bannerMsg.kind === "ok" ? "#166534" : "#991b1b",
          border:     bannerMsg.kind === "ok" ? "1px solid #86efac" : "1px solid #fca5a5",
          fontSize: "0.8125rem",
        }}>
          {bannerMsg.text}
        </div>
      )}

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.625rem", flexWrap: "wrap", alignItems: "center" }} className="no-print">
        <button type="button" onClick={selectAll} className="btn-secondary" style={{ fontSize: "0.75rem" }}>Select all</button>
        <button type="button" onClick={selectNone} className="btn-secondary" style={{ fontSize: "0.75rem" }}>Select none</button>
        <span style={{ fontSize: "0.8125rem", color: "#57534e", marginLeft: "auto" }}>
          {selectedAllocations.length} alloc{selectedAllocations.length === 1 ? "" : "s"} ·
          {" "}{distinctSuppliers} supplier{distinctSuppliers === 1 ? "" : "s"} ·
          {" "}<strong>{fmtMoney(allocatedValue)}</strong>
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={pending || selectedAllocations.length === 0}
          className="btn-primary"
          style={{ fontSize: "0.875rem" }}
        >
          {pending ? "Creating…" : `Create draft POs (${distinctSuppliers})`}
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
          <thead>
            <tr style={{ background: "#fafaf9" }}>
              <th style={th}><input type="checkbox" checked={Object.values(state).every(s => s.selected)} onChange={e => (e.target.checked ? selectAll() : selectNone())} /></th>
              <th style={th}>Code</th>
              <th style={th}>Item</th>
              <th style={th}>Triggers</th>
              <th style={{ ...th, textAlign: "right" }}>SOH</th>
              <th style={{ ...th, textAlign: "right" }}>Min</th>
              <th style={{ ...th, textAlign: "right" }}>Plan need</th>
              <th style={{ ...th, textAlign: "right" }}>Earliest need</th>
              <th style={{ ...th, textAlign: "right" }}>Recommended</th>
              <th style={th}>Allocations</th>
              <th style={{ ...th, textAlign: "right" }}>Σ qty</th>
              <th style={{ ...th, textAlign: "right" }}>$ Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const s = state[r.item_id];
              const sumQty = s.allocations.reduce((sum, a) => sum + (parseFloat(a.qty) || 0), 0);
              const sumValue = s.allocations.reduce((sum, a) => sum + (parseFloat(a.qty) || 0) * (parseFloat(a.unit_price) || 0), 0);
              const itemSuppliers = (siByItem.get(r.item_id) ?? []);
              const supplierIdsForItem = new Set(itemSuppliers.map(x => x.supplier_id));
              return (
                <tr key={r.item_id} style={{ borderBottom: "1px solid #f5f5f4", verticalAlign: "top" }}>
                  <td style={td}>
                    <input type="checkbox" checked={s.selected} onChange={e => setItemSelected(r.item_id, e.target.checked)} />
                  </td>
                  <td style={{ ...td, fontFamily: "monospace", fontSize: "0.7rem", color: "#57534e" }}>{r.item_code}</td>
                  <td style={td}>{r.item_name}</td>
                  <td style={td}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
                      {r.trigger_min       && <Pill color="red"   label={`Min: ${fmtQty(r.current_stock)} ≤ ${fmtQty(r.min_stock)}`} />}
                      {r.trigger_plan      && <Pill color="amber" label={`Plan: need ${fmtQty(r.plan_to_order)}`} />}
                      {r.trigger_lead_time && <Pill color="yellow" label={`Lead-time: ${r.cheapest_supplier_lead_time_days}d`} />}
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtQty(r.current_stock)}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.min_stock > 0 ? fmtQty(r.min_stock) : "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.plan_to_order > 0 ? "#991b1b" : "#a8a29e" }}>
                    {r.plan_to_order > 0 ? fmtQty(r.plan_to_order) : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontSize: "0.75rem", color: "#78716c" }}>
                    {r.earliest_needed_date ? new Date(r.earliest_needed_date).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                    {r.recommended_qty > 0 ? fmtQty(r.recommended_qty) : "—"}
                  </td>
                  <td style={{ ...td, padding: "0.25rem 0.5rem" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      {s.allocations.map((a, idx) => (
                        <div key={a.id} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 1fr) 80px 90px 22px", gap: "0.25rem", alignItems: "center" }}>
                          <select
                            value={a.supplier_id}
                            onChange={e => changeAllocationSupplier(r.item_id, a.id, e.target.value)}
                            style={{ fontSize: "0.75rem", padding: "0.25rem 0.4rem", border: "1px solid #d6d3d1", borderRadius: "0.25rem", background: "#fff" }}
                          >
                            <option value="">— pick supplier —</option>
                            {suppliers.map(sup => (
                              <option key={sup.id} value={sup.id} style={{ fontWeight: supplierIdsForItem.has(sup.id) ? 600 : 400 }}>
                                {sup.name}{supplierIdsForItem.has(sup.id) ? " ✓" : ""}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            value={a.qty}
                            onChange={e => updateAllocation(r.item_id, a.id, { qty: e.target.value })}
                            placeholder="qty"
                            style={{ fontSize: "0.75rem", padding: "0.25rem 0.4rem", border: "1px solid #d6d3d1", borderRadius: "0.25rem", textAlign: "right" }}
                          />
                          <input
                            type="number"
                            value={a.unit_price}
                            onChange={e => updateAllocation(r.item_id, a.id, { unit_price: e.target.value })}
                            placeholder="$/u"
                            style={{ fontSize: "0.75rem", padding: "0.25rem 0.4rem", border: "1px solid #d6d3d1", borderRadius: "0.25rem", textAlign: "right" }}
                          />
                          {idx === 0 ? (
                            <button type="button" onClick={() => addSplit(r.item_id)} title="Split across another supplier"
                              style={{ background: "#fff", border: "1px solid #d6d3d1", borderRadius: "0.25rem", cursor: "pointer", padding: "0.125rem 0.25rem", fontSize: "0.75rem" }}>+</button>
                          ) : (
                            <button type="button" onClick={() => removeAllocation(r.item_id, a.id)} title="Remove this allocation"
                              style={{ background: "#fff", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: "0.25rem", cursor: "pointer", padding: "0.125rem 0.25rem", fontSize: "0.75rem" }}>×</button>
                          )}
                        </div>
                      ))}
                      {s.allocations.length > 1 && (
                        <button type="button" onClick={() => resetItem(r.item_id)} style={{ fontSize: "0.7rem", color: "#78716c", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}>
                          ↺ reset to single cheapest line
                        </button>
                      )}
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums",
                              color: sumQty < r.recommended_qty ? "#92400e" : sumQty > r.recommended_qty ? "#7c2d12" : "#15803d",
                              fontWeight: 600 }}>
                    {fmtQty(sumQty)}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                    {sumValue > 0 ? fmtMoney(sumValue) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Pill({ color, label }: { color: "red" | "amber" | "yellow"; label: string }) {
  const palette = {
    red:    { bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" },
    amber:  { bg: "#ffedd5", fg: "#9a3412", border: "#fdba74" },
    yellow: { bg: "#fef9c3", fg: "#854d0e", border: "#fde68a" },
  }[color];
  return (
    <span style={{
      display: "inline-block", maxWidth: "100%",
      padding: "0.0625rem 0.4rem",
      fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.02em",
      background: palette.bg, color: palette.fg,
      border: `1px solid ${palette.border}`, borderRadius: "0.25rem",
      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    }}>{label}</span>
  );
}

const th: React.CSSProperties = {
  padding: "0.5rem 0.625rem",
  textAlign: "left",
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#57534e",
  borderBottom: "1px solid #d6d3d1",
  whiteSpace: "nowrap",
  background: "#fafaf9",
  position: "sticky",
  top: 0,
  zIndex: 1,
};
const td: React.CSSProperties = {
  padding: "0.4rem 0.625rem",
};
