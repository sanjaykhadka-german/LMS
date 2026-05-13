"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateFillingOrder } from "../../actions";
import { useOfflineAction } from "@/lib/offline/use-action";

type FillingOrder = {
  id: string;
  kg_planned: number;
  kg_produced: number | null;
  n_links_planned: number | null;
  n_links_produced: number | null;
  fill_weight_raw_g: number | null;
  fill_date: string | null;
  status: string;
  notes: string | null;
  fill_item: { id: string; code: string; name: string } | null;
  production_order: {
    id: string;
    batch_number: string;
    item: { id: string; code: string; name: string } | null;
    production_date: string | null;
  } | null;
};

const STATUS_COLOR: Record<string, string> = {
  planned: "badge-gray", in_progress: "badge-yellow",
  completed: "badge-green", cancelled: "badge-red", on_hold: "badge-yellow",
};

export default function FillingQueue({ orders }: { orders: FillingOrder[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actuals, setActuals] = useState<Record<string, {
    kg_produced: string; n_links_produced: string; fill_date: string; notes: string;
  }>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});

  const runUpdate = useOfflineAction("updateFillingOrder", updateFillingOrder);
  const getA = (id: string) => actuals[id] ?? { kg_produced: "", n_links_produced: "", fill_date: "", notes: "" };
  const setField = (id: string, field: string, value: string) =>
    setActuals(prev => ({ ...prev, [id]: { ...getA(id), [field]: value } }));

  const save = (orderId: string, status: string) => {
    startTransition(async () => {
      const a = getA(orderId);
      const result = await runUpdate(orderId, {
        status,
        kg_produced: a.kg_produced ? Number(a.kg_produced) : null,
        n_links_produced: a.n_links_produced ? Number(a.n_links_produced) : null,
        fill_date: a.fill_date || null,
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
        <div style={{ fontSize: "2rem" }}>🌭</div>
        <p style={{ marginTop: "0.5rem" }}>No filling orders in the queue.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {orders.map(order => {
        const isOpen = expanded === order.id;
        const a = getA(order.id);
        const yieldPct = order.kg_produced && order.kg_planned
          ? Math.round((order.kg_produced / order.kg_planned) * 100)
          : null;

        return (
          <div key={order.id} className="card" style={{ padding: 0 }}>
            <div
              style={{ padding: "0.875rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem", cursor: "pointer" }}
              onClick={() => setExpanded(isOpen ? null : order.id)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: "600", color: "#1c1917" }}>{order.fill_item?.name ?? "—"}</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{order.fill_item?.code}</span>
                  <span className={`badge ${STATUS_COLOR[order.status]}`} style={{ fontSize: "0.625rem" }}>
                    {order.status.replace("_", " ")}
                  </span>
                </div>
                <div style={{ marginTop: "0.25rem", fontSize: "0.8125rem", color: "#78716c", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  <span>From: <Link href="#" style={{ color: "#b91c1c", textDecoration: "none" }}>{order.production_order?.batch_number}</Link> — {order.production_order?.item?.name}</span>
                  <span>Planned: <strong style={{ color: "#292524" }}>{order.kg_planned} kg</strong></span>
                  {order.n_links_planned && <span>{order.n_links_planned} links planned</span>}
                  {order.fill_weight_raw_g && <span>Target fill: {order.fill_weight_raw_g}g/unit</span>}
                  {order.kg_produced != null && (
                    <span style={{ color: "#166534" }}>✓ {order.kg_produced} kg produced ({yieldPct}%)</span>
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
                    <label className="form-label">kg Produced</label>
                    <input className="form-input" type="number" step="0.1" placeholder={String(order.kg_planned)}
                      value={a.kg_produced} onChange={e => setField(order.id, "kg_produced", e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Links Produced</label>
                    <input className="form-input" type="number" step="1" placeholder={order.n_links_planned ? String(order.n_links_planned) : "—"}
                      value={a.n_links_produced} onChange={e => setField(order.id, "n_links_produced", e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Fill Date</label>
                    <input className="form-input" type="date"
                      value={a.fill_date} onChange={e => setField(order.id, "fill_date", e.target.value)} />
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
