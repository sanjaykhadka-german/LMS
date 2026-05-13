"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type DispatchLine = {
  id: string;
  line_number: number;
  order_uom: string | null;
  qty_ordered: number | null;
  qty_inners: number | null;
  qty_kg_estimated: number | null;
  unit_price: number | null;
  notes: string | null;
  item: {
    id: string; code: string; name: string;
    weight_mode: string | null;
    target_weight_g: number | null;
    units_per_inner: number | null;
    inner_per_outer: number | null;
  } | null;
};

type DispatchOrder = {
  id: string;
  order_number: string;
  customer_name: string;
  customer_po: string | null;
  required_date: string | null;
  currency: string;
  lines: DispatchLine[];
};

type LotEntry = {
  _key: string;
  dispatch_uom: string;   // inner | carton | kg
  qty_dispatched: string; // numeric string
  batch_number: string;
  use_by_date: string;    // YYYY-MM-DD
};

// Map line ID → array of lot entries
type LineLots = Record<string, LotEntry[]>;

function makeKey() { return Math.random().toString(36).slice(2); }

/** Which UOM options are valid for this line */
function uomOptions(line: DispatchLine): { value: string; label: string }[] {
  const wm = line.item?.weight_mode;
  if (wm === "random") return [{ value: "kg", label: "kg" }];
  return [
    { value: "inner", label: "Inners" },
    { value: "carton", label: "Cartons" },
  ];
}

function defaultUom(line: DispatchLine): string {
  if (line.item?.weight_mode === "random") return "kg";
  return line.order_uom ?? "inner";
}

function defaultLot(line: DispatchLine): LotEntry {
  const uom = defaultUom(line);
  // Pre-fill quantity from order
  let qty = "";
  if (line.item?.weight_mode === "random") {
    qty = line.qty_kg_estimated != null ? String(line.qty_kg_estimated) : "";
  } else {
    qty = line.qty_ordered != null ? String(line.qty_ordered) : "";
  }
  return { _key: makeKey(), dispatch_uom: uom, qty_dispatched: qty, batch_number: "", use_by_date: "" };
}

function uomLabel(uom: string) {
  return ({ inner: "inners", carton: "cartons", kg: "kg" } as Record<string, string>)[uom] ?? uom;
}

function initLineLots(orders: DispatchOrder[]): Record<string, LineLots> {
  const result: Record<string, LineLots> = {};
  for (const o of orders) {
    result[o.id] = {};
    for (const l of o.lines) {
      result[o.id][l.id] = [defaultLot(l)];
    }
  }
  return result;
}

export default function FloorDispatch({
  orders,
  redirectAfterDispatch,
}: {
  orders: DispatchOrder[];
  redirectAfterDispatch?: string;
}) {
  const router = useRouter();
  const [activeOrderId, setActiveOrderId] = useState<string | null>(orders[0]?.id ?? null);
  // orderLots: orderId → lineLots
  const [orderLots, setOrderLots] = useState<Record<string, LineLots>>(() => initLineLots(orders));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dispatched, setDispatched] = useState<Set<string>>(new Set());

  // ── Lot mutation helpers ──────────────────────────────────────────────────

  const getLots = useCallback((orderId: string, lineId: string): LotEntry[] => {
    return orderLots[orderId]?.[lineId] ?? [];
  }, [orderLots]);

  function updateLot(orderId: string, lineId: string, lotKey: string, changes: Partial<LotEntry>) {
    setOrderLots(prev => {
      const lots = [...(prev[orderId]?.[lineId] ?? [])];
      const idx = lots.findIndex(l => l._key === lotKey);
      if (idx === -1) return prev;
      lots[idx] = { ...lots[idx], ...changes };
      return { ...prev, [orderId]: { ...prev[orderId], [lineId]: lots } };
    });
  }

  function addLot(orderId: string, lineId: string, line: DispatchLine) {
    setOrderLots(prev => {
      const lots = [...(prev[orderId]?.[lineId] ?? [])];
      // New lot: same uom as previous, qty blank
      const prevUom = lots[lots.length - 1]?.dispatch_uom ?? defaultUom(line);
      lots.push({ _key: makeKey(), dispatch_uom: prevUom, qty_dispatched: "", batch_number: "", use_by_date: "" });
      return { ...prev, [orderId]: { ...prev[orderId], [lineId]: lots } };
    });
  }

  function removeLot(orderId: string, lineId: string, lotKey: string) {
    setOrderLots(prev => {
      const lots = (prev[orderId]?.[lineId] ?? []).filter(l => l._key !== lotKey);
      if (lots.length === 0) return prev; // always keep at least one
      return { ...prev, [orderId]: { ...prev[orderId], [lineId]: lots } };
    });
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────

  async function handleDispatch(order: DispatchOrder) {
    setSaving(true);
    setError(null);

    const today = new Date().toISOString().slice(0, 10);
    const lineLots = orderLots[order.id] ?? {};

    const lines = order.lines.map(l => {
      const lots = (lineLots[l.id] ?? [])
        .filter(lot => lot.qty_dispatched.trim() !== "")
        .map(lot => ({
          dispatch_uom: lot.dispatch_uom,
          qty_dispatched: parseFloat(lot.qty_dispatched) || 0,
          batch_number: lot.batch_number.trim() || null,
          use_by_date: lot.use_by_date || null,
        }));

      // Summary: total qty in the primary dispatch uom of this line
      const primaryUom = lots[0]?.dispatch_uom ?? defaultUom(l);
      const totalQty = lots
        .filter(lot => lot.dispatch_uom === primaryUom)
        .reduce((sum, lot) => sum + lot.qty_dispatched, 0);

      // For random weight: sum actual kg across all lots
      const totalKg = l.item?.weight_mode === "random"
        ? lots.reduce((sum, lot) => sum + lot.qty_dispatched, 0)
        : null;

      return {
        id: l.id,
        lots,
        dispatch_uom: primaryUom,
        qty_dispatched: totalQty || null,
        qty_kg_actual: totalKg,
      };
    });

    const res = await fetch(`/api/orders/${order.id}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dispatch_date: today, lines }),
    });

    setSaving(false);

    if (!res.ok) {
      const json = await res.json() as { error?: string };
      setError(json.error ?? "Dispatch failed");
      return;
    }

    setDispatched(prev => new Set([...prev, order.id]));
    const remaining = orders.filter(o => o.id !== order.id && !dispatched.has(o.id));
    setActiveOrderId(remaining[0]?.id ?? null);

    if (redirectAfterDispatch) {
      router.push(redirectAfterDispatch);
      router.refresh();
    } else {
      router.refresh();
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const pendingOrders = orders.filter(o => !dispatched.has(o.id));

  if (pendingOrders.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "4rem 1rem" }}>
        <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>✅</div>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 0.5rem" }}>All orders dispatched</h2>
        <p style={{ color: "#78716c", marginBottom: "1.5rem" }}>No more orders ready for dispatch today.</p>
        <Link href="/orders" className="btn-secondary">← Back to Orders</Link>
      </div>
    );
  }

  const activeOrder = pendingOrders.find(o => o.id === activeOrderId) ?? pendingOrders[0];

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto" }}>

      {/* Order selector tabs */}
      {pendingOrders.length > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.5rem", marginBottom: "1rem" }}>
          {pendingOrders.map(o => (
            <button
              key={o.id}
              type="button"
              onClick={() => setActiveOrderId(o.id)}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "999px",
                border: "2px solid",
                borderColor: o.id === activeOrder.id ? "#b91c1c" : "#e7e5e4",
                background: o.id === activeOrder.id ? "#fef2f2" : "#fff",
                color: o.id === activeOrder.id ? "#b91c1c" : "#44403c",
                fontWeight: o.id === activeOrder.id ? 700 : 400,
                fontSize: "0.875rem",
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              #{o.order_number}
            </button>
          ))}
        </div>
      )}

      {/* Active order card */}
      <div className="card" style={{ padding: 0 }}>

        {/* Order header */}
        <div style={{ padding: "1.25rem", borderBottom: "1px solid #e7e5e4" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: "1.375rem", fontWeight: 800, fontFamily: "monospace" }}>#{activeOrder.order_number}</div>
              <div style={{ fontSize: "1rem", fontWeight: 600, marginTop: "0.125rem" }}>{activeOrder.customer_name}</div>
              {activeOrder.customer_po && (
                <div style={{ fontSize: "0.8125rem", color: "#78716c", marginTop: "0.125rem" }}>PO: {activeOrder.customer_po}</div>
              )}
            </div>
            <div style={{ textAlign: "right" }}>
              {activeOrder.required_date && (
                <>
                  <div style={{ fontSize: "0.8125rem", color: "#78716c" }}>Required</div>
                  <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>
                    {new Date(activeOrder.required_date).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                  </div>
                </>
              )}
              <div style={{ marginTop: "0.375rem" }}>
                <span style={{ fontSize: "0.75rem", background: "#dbeafe", color: "#1e40af", padding: "0.2rem 0.625rem", borderRadius: "999px", fontWeight: 600 }}>
                  CONFIRMED
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Lines */}
        <div style={{ padding: "0.75rem 1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          {activeOrder.lines.map(line => {
            const isRandom = line.item?.weight_mode === "random";
            const lots = getLots(activeOrder.id, line.id);
            const opts = uomOptions(line);

            return (
              <div key={line.id} style={{
                background: isRandom ? "#fffbeb" : "#fafaf9",
                border: `1px solid ${isRandom ? "#fde68a" : "#e7e5e4"}`,
                borderRadius: "0.625rem",
                padding: "0.875rem",
              }}>
                {/* Item header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.875rem" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "1rem" }}>{line.item?.name ?? "Unknown item"}</div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{line.item?.code}</div>
                    {isRandom && (
                      <div style={{ fontSize: "0.75rem", color: "#b45309", marginTop: "0.125rem" }}>⚖ Random weight — enter actual kg</div>
                    )}
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, marginLeft: "1rem" }}>
                    <div style={{ fontSize: "0.75rem", color: "#78716c" }}>Ordered</div>
                    <div style={{ fontSize: "1.125rem", fontWeight: 700 }}>
                      {line.qty_ordered} <span style={{ fontSize: "0.8125rem", fontWeight: 400, color: "#78716c" }}>{uomLabel(line.order_uom ?? "")}</span>
                    </div>
                    {line.qty_inners != null && (
                      <div style={{ fontSize: "0.75rem", color: "#78716c" }}>{line.qty_inners} inners</div>
                    )}
                    {isRandom && line.qty_kg_estimated != null && (
                      <div style={{ fontSize: "0.75rem", color: "#b45309" }}>~{line.qty_kg_estimated.toFixed(1)} kg est.</div>
                    )}
                  </div>
                </div>

                {/* Column headers */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: isRandom ? "80px 1fr 1fr 32px" : "100px 80px 1fr 1fr 32px",
                  gap: "0.375rem",
                  marginBottom: "0.25rem",
                }}>
                  {!isRandom && <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase" }}>UOM</div>}
                  <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase" }}>{isRandom ? "kg Actual" : "Qty"}</div>
                  <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase" }}>Batch / Lot</div>
                  <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase" }}>Use By</div>
                  <div />
                </div>

                {/* Lot rows */}
                {lots.map((lot, idx) => (
                  <div key={lot._key} style={{
                    display: "grid",
                    gridTemplateColumns: isRandom ? "80px 1fr 1fr 32px" : "100px 80px 1fr 1fr 32px",
                    gap: "0.375rem",
                    marginBottom: "0.375rem",
                    alignItems: "center",
                  }}>
                    {/* UOM select (fixed weight only) */}
                    {!isRandom && (
                      <select
                        value={lot.dispatch_uom}
                        onChange={e => updateLot(activeOrder.id, line.id, lot._key, { dispatch_uom: e.target.value })}
                        style={{
                          padding: "0.5rem 0.375rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #d6d3d1",
                          fontSize: "0.8125rem",
                          background: "#fff",
                        }}
                      >
                        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    )}

                    {/* Qty / actual kg */}
                    <input
                      type="number"
                      min="0"
                      step={isRandom ? "0.001" : "1"}
                      value={lot.qty_dispatched}
                      onChange={e => updateLot(activeOrder.id, line.id, lot._key, { qty_dispatched: e.target.value })}
                      placeholder={isRandom ? "0.000" : "0"}
                      style={{
                        padding: "0.5rem 0.5rem",
                        borderRadius: "0.375rem",
                        border: `2px solid ${isRandom ? "#f59e0b" : "#d6d3d1"}`,
                        fontSize: isRandom ? "1rem" : "0.9375rem",
                        fontWeight: 700,
                        background: "#fff",
                        width: "100%",
                        boxSizing: "border-box" as const,
                      }}
                    />

                    {/* Batch */}
                    <input
                      type="text"
                      value={lot.batch_number}
                      onChange={e => updateLot(activeOrder.id, line.id, lot._key, { batch_number: e.target.value })}
                      placeholder="Batch / Lot #"
                      style={{
                        padding: "0.5rem 0.5rem",
                        borderRadius: "0.375rem",
                        border: "1px solid #d6d3d1",
                        fontSize: "0.8125rem",
                        fontFamily: "monospace",
                        background: "#fff",
                        width: "100%",
                        boxSizing: "border-box" as const,
                      }}
                    />

                    {/* UBD */}
                    <input
                      type="date"
                      value={lot.use_by_date}
                      onChange={e => updateLot(activeOrder.id, line.id, lot._key, { use_by_date: e.target.value })}
                      style={{
                        padding: "0.5rem 0.375rem",
                        borderRadius: "0.375rem",
                        border: "1px solid #d6d3d1",
                        fontSize: "0.8125rem",
                        background: "#fff",
                        width: "100%",
                        boxSizing: "border-box" as const,
                      }}
                    />

                    {/* Remove lot button */}
                    <button
                      type="button"
                      onClick={() => removeLot(activeOrder.id, line.id, lot._key)}
                      disabled={lots.length === 1}
                      title="Remove this lot"
                      style={{
                        width: "28px", height: "28px",
                        borderRadius: "50%",
                        border: "1px solid #e7e5e4",
                        background: lots.length === 1 ? "transparent" : "#fff",
                        color: lots.length === 1 ? "#d6d3d1" : "#b91c1c",
                        cursor: lots.length === 1 ? "default" : "pointer",
                        fontSize: "0.875rem",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                        padding: 0,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}

                {/* Add lot */}
                <button
                  type="button"
                  onClick={() => addLot(activeOrder.id, line.id, line)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "0.25rem",
                    marginTop: "0.25rem",
                    padding: "0.25rem 0.625rem",
                    borderRadius: "0.375rem",
                    border: "1px dashed #d6d3d1",
                    background: "transparent",
                    color: "#78716c",
                    fontSize: "0.8125rem",
                    cursor: "pointer",
                  }}
                >
                  + Add batch / lot
                </button>

                {line.notes && (
                  <div style={{ marginTop: "0.5rem", fontSize: "0.8125rem", color: "#78716c", fontStyle: "italic" }}>
                    Note: {line.notes}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div style={{ margin: "0 1.25rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", padding: "0.75rem", color: "#991b1b", fontSize: "0.875rem" }}>
            {error}
          </div>
        )}

        {/* Dispatch button */}
        <div style={{ padding: "1rem 1.25rem", borderTop: "1px solid #e7e5e4" }}>
          <button
            type="button"
            disabled={saving}
            onClick={() => handleDispatch(activeOrder)}
            style={{
              display: "block",
              width: "100%",
              padding: "1rem",
              fontSize: "1.125rem",
              fontWeight: 800,
              background: saving ? "#d6d3d1" : "#15803d",
              color: "#fff",
              border: "none",
              borderRadius: "0.625rem",
              cursor: saving ? "not-allowed" : "pointer",
              letterSpacing: "0.025em",
            }}
          >
            {saving ? "Saving…" : `✓ Dispatch Order #${activeOrder.order_number}`}
          </button>
        </div>
      </div>

      {/* Footer count */}
      <div style={{ textAlign: "center", marginTop: "1rem", fontSize: "0.8125rem", color: "#78716c" }}>
        {dispatched.size} of {orders.length} orders dispatched today ·{" "}
        <Link href="/orders/floor" style={{ color: "#b91c1c" }}>Back to dispatch list</Link>
      </div>
    </div>
  );
}
