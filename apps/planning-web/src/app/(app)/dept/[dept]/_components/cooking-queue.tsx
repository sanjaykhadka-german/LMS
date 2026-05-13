"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCookingOrder } from "../../actions";
import { useOfflineAction } from "@/lib/offline/use-action";

type CookingOrder = {
  id: string;
  cook_date: string | null;
  raw_weight_in_kg: number | null;
  cooked_weight_out_kg: number | null;
  yield_pct: number | null;
  core_temp_achieved_c: number | null;
  cook_program: string | null;
  oven_id: string | null;
  cook_start_time: string | null;
  cook_end_time: string | null;
  status: string;
  notes: string | null;
  filling_order: {
    id: string;
    kg_planned: number;
    fill_item: { id: string; code: string; name: string } | null;
    production_order: {
      batch_number: string;
      item: { name: string } | null;
    } | null;
  } | null;
};

const STATUS_COLOR: Record<string, string> = {
  planned: "badge-gray", in_progress: "badge-yellow",
  completed: "badge-green", cancelled: "badge-red", on_hold: "badge-yellow",
};

export default function CookingQueue({ orders }: { orders: CookingOrder[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actuals, setActuals] = useState<Record<string, {
    raw_weight_in_kg: string; cooked_weight_out_kg: string;
    core_temp_achieved_c: string; cook_program: string;
    oven_id: string; cook_start_time: string; cook_end_time: string;
    cook_date: string; notes: string;
  }>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});

  const getA = (id: string) => actuals[id] ?? {
    raw_weight_in_kg: "", cooked_weight_out_kg: "", core_temp_achieved_c: "",
    cook_program: "", oven_id: "", cook_start_time: "", cook_end_time: "", cook_date: "", notes: "",
  };
  const setField = (id: string, field: string, value: string) =>
    setActuals(prev => ({ ...prev, [id]: { ...getA(id), [field]: value } }));

  const runUpdate = useOfflineAction("updateCookingOrder", updateCookingOrder);

  const save = (orderId: string, status: string) => {
    startTransition(async () => {
      const a = getA(orderId);
      const rawIn = a.raw_weight_in_kg ? Number(a.raw_weight_in_kg) : null;
      const cookedOut = a.cooked_weight_out_kg ? Number(a.cooked_weight_out_kg) : null;
      const yieldPct = rawIn && cookedOut ? Math.round((cookedOut / rawIn) * 1000) / 10 : null;

      const result = await runUpdate(orderId, {
        status,
        raw_weight_in_kg: rawIn,
        cooked_weight_out_kg: cookedOut,
        yield_pct: yieldPct,
        core_temp_achieved_c: a.core_temp_achieved_c ? Number(a.core_temp_achieved_c) : null,
        cook_program: a.cook_program || null,
        oven_id: a.oven_id || null,
        cook_start_time: a.cook_start_time || null,
        cook_end_time: a.cook_end_time || null,
        cook_date: a.cook_date || null,
        notes: a.notes || null,
      });
      if (result.queued) setMsg(prev => ({ ...prev, [orderId]: "📵 Saved offline — will sync when reconnected" }));
      else if (result.error) setMsg(prev => ({ ...prev, [orderId]: result.error! }));
      else { setMsg(prev => ({ ...prev, [orderId]: "Saved ✓" })); router.refresh(); }
    });
  };

  if (orders.length === 0) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#78716c" }}>
        <div style={{ fontSize: "2rem" }}>🔥</div>
        <p style={{ marginTop: "0.5rem" }}>No cooking orders in the queue.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {orders.map(order => {
        const isOpen = expanded === order.id;
        const a = getA(order.id);
        const liveYield = a.raw_weight_in_kg && a.cooked_weight_out_kg
          ? ((Number(a.cooked_weight_out_kg) / Number(a.raw_weight_in_kg)) * 100).toFixed(1)
          : null;

        return (
          <div key={order.id} className="card" style={{ padding: 0 }}>
            <div
              style={{ padding: "0.875rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem", cursor: "pointer" }}
              onClick={() => setExpanded(isOpen ? null : order.id)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: "600", color: "#1c1917" }}>
                    {order.filling_order?.fill_item?.name ?? "—"}
                  </span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>
                    {order.filling_order?.fill_item?.code}
                  </span>
                  <span className={`badge ${STATUS_COLOR[order.status]}`} style={{ fontSize: "0.625rem" }}>
                    {order.status.replace("_", " ")}
                  </span>
                </div>
                <div style={{ marginTop: "0.25rem", fontSize: "0.8125rem", color: "#78716c", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  <span>Batch: {order.filling_order?.production_order?.batch_number} — {order.filling_order?.production_order?.item?.name}</span>
                  <span>In: <strong style={{ color: "#292524" }}>{order.raw_weight_in_kg ?? "?"} kg</strong></span>
                  {order.cooked_weight_out_kg && (
                    <span style={{ color: "#166534" }}>Out: {order.cooked_weight_out_kg} kg · Yield: {order.yield_pct}%</span>
                  )}
                  {order.core_temp_achieved_c && <span>🌡 {order.core_temp_achieved_c}°C</span>}
                  {order.oven_id && <span>Oven: {order.oven_id}</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {order.status === "planned" && (
                  <button className="btn-primary" style={{ fontSize: "0.75rem", padding: "0.3125rem 0.75rem" }}
                    onClick={e => { e.stopPropagation(); save(order.id, "in_progress"); }} disabled={isPending}>▶ Start</button>
                )}
                {order.status === "in_progress" && (
                  <button style={{ fontSize: "0.75rem", padding: "0.3125rem 0.75rem", background: "#166534", color: "white", border: "none", borderRadius: "0.375rem", cursor: "pointer", fontWeight: "600" }}
                    onClick={e => { e.stopPropagation(); save(order.id, "completed"); }} disabled={isPending}>✓ Complete</button>
                )}
                <span style={{ color: "#78716c" }}>{isOpen ? "▲" : "▼"}</span>
              </div>
            </div>

            {isOpen && (
              <div style={{ borderTop: "1px solid #e7e5e4", padding: "1rem 1.25rem", background: "#fafaf9" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.875rem", marginBottom: "0.875rem" }}>
                  <div>
                    <label className="form-label">Cook Date</label>
                    <input className="form-input" type="date"
                      value={a.cook_date} onChange={e => setField(order.id, "cook_date", e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Raw Weight In (kg)</label>
                    <input className="form-input" type="number" step="0.1" placeholder="kg before cooking"
                      value={a.raw_weight_in_kg} onChange={e => setField(order.id, "raw_weight_in_kg", e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Cooked Weight Out (kg)</label>
                    <input className="form-input" type="number" step="0.1" placeholder="kg after cooking"
                      value={a.cooked_weight_out_kg} onChange={e => setField(order.id, "cooked_weight_out_kg", e.target.value)} />
                    {liveYield && (
                      <div style={{ fontSize: "0.75rem", marginTop: "0.25rem", color: Number(liveYield) < 70 ? "#dc2626" : "#166534" }}>
                        Yield: {liveYield}%
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="form-label">Core Temp (°C) *HACCP</label>
                    <input className="form-input" type="number" step="0.1" placeholder="e.g. 72"
                      value={a.core_temp_achieved_c} onChange={e => setField(order.id, "core_temp_achieved_c", e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Cook Program</label>
                    <input className="form-input" placeholder="e.g. Smoke 65°C / 3h"
                      value={a.cook_program} onChange={e => setField(order.id, "cook_program", e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Oven / Smoker ID</label>
                    <input className="form-input" placeholder="e.g. Oven-1"
                      value={a.oven_id} onChange={e => setField(order.id, "oven_id", e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Start Time</label>
                    <input className="form-input" type="datetime-local"
                      value={a.cook_start_time} onChange={e => setField(order.id, "cook_start_time", e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">End Time</label>
                    <input className="form-input" type="datetime-local"
                      value={a.cook_end_time} onChange={e => setField(order.id, "cook_end_time", e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Notes</label>
                    <input className="form-input" placeholder="Issues or observations…"
                      value={a.notes} onChange={e => setField(order.id, "notes", e.target.value)} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <button className="btn-primary" style={{ fontSize: "0.8125rem" }}
                    onClick={() => save(order.id, order.status)} disabled={isPending}>Save Actuals</button>
                  {order.status === "in_progress" && (
                    <button style={{ fontSize: "0.8125rem", background: "#166534", color: "white", border: "none", borderRadius: "0.375rem", padding: "0.5rem 0.875rem", cursor: "pointer", fontWeight: "600" }}
                      onClick={() => save(order.id, "completed")} disabled={isPending}>Save & Complete</button>
                  )}
                  {msg[order.id] && (
                    <span style={{ fontSize: "0.8125rem", color: msg[order.id].includes("✓") ? "#166534" : "#dc2626" }}>{msg[order.id]}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
