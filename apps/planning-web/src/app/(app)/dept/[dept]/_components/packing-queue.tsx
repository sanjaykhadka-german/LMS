"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePackingOrder } from "../../actions";
import { useOfflineAction } from "@/lib/offline/use-action";

type PackingOrder = {
  id: string;
  pack_date: string | null;
  day_of_week: number | null;
  planned_units: number | null;
  packed_units: number | null;
  wastage_units: number | null;
  total_giveaway_g: number | null;
  avg_giveaway_g: number | null;
  planned_weight_kg: number | null;
  packed_weight_kg: number | null;
  wastage_weight_kg: number | null;
  status: string;
  notes: string | null;
  pack_item: {
    id: string; code: string; name: string;
    weight_mode: string; target_weight_g: number | null;
  } | null;
  cooking_order: {
    filling_order: {
      production_order: { batch_number: string } | null;
    } | null;
  } | null;
};

const STATUS_COLOR: Record<string, string> = {
  planned: "badge-gray", in_progress: "badge-yellow",
  completed: "badge-green", cancelled: "badge-red", on_hold: "badge-yellow",
};
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function PackingQueue({ orders }: { orders: PackingOrder[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actuals, setActuals] = useState<Record<string, {
    packed_units: string; wastage_units: string; total_giveaway_g: string;
    packed_weight_kg: string; wastage_weight_kg: string;
    pack_date: string; notes: string;
  }>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});

  const getA = (id: string) => actuals[id] ?? {
    packed_units: "", wastage_units: "", total_giveaway_g: "",
    packed_weight_kg: "", wastage_weight_kg: "", pack_date: "", notes: "",
  };
  const setField = (id: string, field: string, value: string) =>
    setActuals(prev => ({ ...prev, [id]: { ...getA(id), [field]: value } }));

  const runUpdate = useOfflineAction("updatePackingOrder", updatePackingOrder);

  const save = (orderId: string, status: string) => {
    startTransition(async () => {
      const a = getA(orderId);
      const packedUnits = a.packed_units ? Number(a.packed_units) : null;
      const totalGiveaway = a.total_giveaway_g ? Number(a.total_giveaway_g) : null;
      const avgGiveaway = packedUnits && totalGiveaway ? Math.round((totalGiveaway / packedUnits) * 10) / 10 : null;

      const result = await runUpdate(orderId, {
        status,
        packed_units: packedUnits,
        wastage_units: a.wastage_units ? Number(a.wastage_units) : null,
        total_giveaway_g: totalGiveaway,
        avg_giveaway_g: avgGiveaway,
        packed_weight_kg: a.packed_weight_kg ? Number(a.packed_weight_kg) : null,
        wastage_weight_kg: a.wastage_weight_kg ? Number(a.wastage_weight_kg) : null,
        pack_date: a.pack_date || null,
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
        <div style={{ fontSize: "2rem" }}>📦</div>
        <p style={{ marginTop: "0.5rem" }}>No packing orders in the queue.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {orders.map(order => {
        const isOpen = expanded === order.id;
        const a = getA(order.id);
        const isFixed = order.pack_item?.weight_mode === "fixed";
        const batchRef = order.cooking_order?.filling_order?.production_order?.batch_number;

        // Live giveaway calc
        const liveGiveaway = a.packed_units && a.total_giveaway_g
          ? (Number(a.total_giveaway_g) / Number(a.packed_units)).toFixed(1)
          : null;
        const targetWeight = order.pack_item?.target_weight_g;

        return (
          <div key={order.id} className="card" style={{ padding: 0 }}>
            <div
              style={{ padding: "0.875rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem", cursor: "pointer" }}
              onClick={() => setExpanded(isOpen ? null : order.id)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: "600", color: "#1c1917" }}>{order.pack_item?.name ?? "—"}</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{order.pack_item?.code}</span>
                  {isFixed
                    ? <span className="badge badge-blue" style={{ fontSize: "0.625rem" }}>Fixed weight</span>
                    : <span className="badge badge-gray" style={{ fontSize: "0.625rem" }}>Random weight</span>
                  }
                  <span className={`badge ${STATUS_COLOR[order.status]}`} style={{ fontSize: "0.625rem" }}>
                    {order.status.replace("_", " ")}
                  </span>
                </div>
                <div style={{ marginTop: "0.25rem", fontSize: "0.8125rem", color: "#78716c", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  {batchRef && <span>Batch: {batchRef}</span>}
                  {order.day_of_week != null && <span>📅 {DAYS[order.day_of_week]}</span>}
                  {isFixed
                    ? <span>Planned: <strong style={{ color: "#292524" }}>{order.planned_units} units</strong> × {targetWeight}g = {order.planned_weight_kg ? `${order.planned_weight_kg} kg` : `${((order.planned_units ?? 0) * (targetWeight ?? 0) / 1000).toFixed(1)} kg`}</span>
                    : <span>Planned: <strong style={{ color: "#292524" }}>{order.planned_weight_kg} kg</strong></span>
                  }
                  {order.packed_units != null && (
                    <span style={{ color: "#166534" }}>✓ Packed: {order.packed_units} units{order.avg_giveaway_g ? ` · avg giveaway: ${order.avg_giveaway_g}g` : ""}</span>
                  )}
                  {order.packed_weight_kg != null && !isFixed && (
                    <span style={{ color: "#166534" }}>✓ Packed: {order.packed_weight_kg} kg</span>
                  )}
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
                    <label className="form-label">Pack Date</label>
                    <input className="form-input" type="date"
                      value={a.pack_date} onChange={e => setField(order.id, "pack_date", e.target.value)} />
                  </div>

                  {isFixed ? (
                    <>
                      <div>
                        <label className="form-label">Units Packed</label>
                        <input className="form-input" type="number" step="1" placeholder={String(order.planned_units ?? "")}
                          value={a.packed_units} onChange={e => setField(order.id, "packed_units", e.target.value)} />
                      </div>
                      <div>
                        <label className="form-label">Wastage (units)</label>
                        <input className="form-input" type="number" step="1" placeholder="0"
                          value={a.wastage_units} onChange={e => setField(order.id, "wastage_units", e.target.value)} />
                      </div>
                      <div>
                        <label className="form-label">Total Giveaway (g)</label>
                        <input className="form-input" type="number" step="0.1" placeholder="0"
                          value={a.total_giveaway_g} onChange={e => setField(order.id, "total_giveaway_g", e.target.value)} />
                        {liveGiveaway && (
                          <div style={{ fontSize: "0.75rem", marginTop: "0.25rem", color: Number(liveGiveaway) > 5 ? "#dc2626" : "#166534" }}>
                            Avg: {liveGiveaway}g/unit {targetWeight ? `(target: ${targetWeight}g)` : ""}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="form-label">Weight Packed (kg)</label>
                        <input className="form-input" type="number" step="0.1" placeholder={String(order.planned_weight_kg ?? "")}
                          value={a.packed_weight_kg} onChange={e => setField(order.id, "packed_weight_kg", e.target.value)} />
                      </div>
                      <div>
                        <label className="form-label">Wastage (kg)</label>
                        <input className="form-input" type="number" step="0.1" placeholder="0"
                          value={a.wastage_weight_kg} onChange={e => setField(order.id, "wastage_weight_kg", e.target.value)} />
                      </div>
                    </>
                  )}

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
