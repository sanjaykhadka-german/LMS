"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createDispatchRecord } from "../../actions";

type PendingDispatch = {
  id: string;
  demand_plan_id: string;
  item_id: string;
  item: { id: string; code: string; name: string; unit: string; weight_mode: string } | null;
  planned_qty_kg: number | null;
  planned_units: number | null;
  customer_name: string | null;
  customer_ref: string | null;
  day_of_week: number | null;
  demand_type: string;
  notes: string | null;
};

type DispatchRecord = {
  id: string;
  dispatch_date: string;
  item: { code: string; name: string } | null;
  qty_units: number | null;
  qty_kg: number | null;
  customer_name: string | null;
  customer_ref: string | null;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function DispatchQueue({
  pendingLines,
  recentDispatches,
}: {
  pendingLines: PendingDispatch[];
  recentDispatches: DispatchRecord[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dispatching, setDispatching] = useState<Record<string, {
    qty_units: string; qty_kg: string; dispatch_date: string;
    customer_name: string; customer_ref: string; notes: string;
  }>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [dispatched, setDispatched] = useState<Set<string>>(new Set());

  const getD = (id: string, line: PendingDispatch) => dispatching[id] ?? {
    qty_units: line.planned_units ? String(line.planned_units) : "",
    qty_kg: line.planned_qty_kg ? String(line.planned_qty_kg) : "",
    dispatch_date: new Date().toISOString().split("T")[0],
    customer_name: line.customer_name ?? "",
    customer_ref: line.customer_ref ?? "",
    notes: "",
  };

  const setField = (id: string, field: string, value: string, line: PendingDispatch) =>
    setDispatching(prev => ({ ...prev, [id]: { ...getD(id, line), [field]: value } }));

  const handleDispatch = (line: PendingDispatch) => {
    startTransition(async () => {
      const d = getD(line.id, line);
      const result = await createDispatchRecord({
        dispatch_date: d.dispatch_date,
        item_id: line.item_id,
        qty_units: d.qty_units ? Number(d.qty_units) : null,
        qty_kg: d.qty_kg ? Number(d.qty_kg) : null,
        customer_name: d.customer_name || null,
        customer_ref: d.customer_ref || null,
        demand_line_id: line.id,
        notes: d.notes || null,
      });
      if (result.error) setMsg(prev => ({ ...prev, [line.id]: result.error! }));
      else {
        setDispatched(prev => new Set(prev).add(line.id));
        setMsg(prev => ({ ...prev, [line.id]: "Dispatched ✓" }));
        router.refresh();
      }
    });
  };

  return (
    <div>
      {/* ── Customer Order Dispatch callout ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "1rem", flexWrap: "wrap",
        background: "#eff6ff", border: "1px solid #bfdbfe",
        borderRadius: "0.625rem", padding: "0.875rem 1.125rem",
        marginBottom: "1.5rem",
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "0.9375rem", color: "#1e40af" }}>
            📦 Looking to dispatch a customer order?
          </div>
          <div style={{ fontSize: "0.8125rem", color: "#3b82f6", marginTop: "0.125rem" }}>
            This page handles production demand plan dispatch. Customer orders have their own screen.
          </div>
        </div>
        <Link
          href="/orders/floor"
          style={{
            display: "inline-block", whiteSpace: "nowrap",
            padding: "0.5rem 1rem", borderRadius: "0.5rem",
            background: "#1d4ed8", color: "#fff",
            fontWeight: 700, fontSize: "0.875rem",
            textDecoration: "none", flexShrink: 0,
          }}
        >
          Go to Dispatch Floor →
        </Link>
      </div>

      {/* Pending dispatch lines */}
      <div className="card" style={{ padding: 0, marginBottom: "1.5rem" }}>
        <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4" }}>
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: "600" }}>Pending Dispatches</h2>
          <div style={{ fontSize: "0.8125rem", color: "#78716c", marginTop: "0.25rem" }}>Demand lines awaiting dispatch from the current active plan</div>
        </div>

        {pendingLines.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
            <div style={{ fontSize: "2rem" }}>🚚</div>
            <p>No pending dispatches.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {pendingLines.map(line => {
              const d = getD(line.id, line);
              const isDone = dispatched.has(line.id);
              const isFixed = line.item?.weight_mode === "fixed";

              return (
                <div key={line.id} style={{
                  borderBottom: "1px solid #f5f5f4",
                  padding: "0.875rem 1.25rem",
                  opacity: isDone ? 0.5 : 1,
                  background: isDone ? "#f0fdf4" : "white",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: "200px" }}>
                      <div style={{ fontWeight: "600", color: "#1c1917" }}>
                        {line.item?.name ?? "—"}
                      </div>
                      <div style={{ fontSize: "0.8125rem", color: "#78716c", marginTop: "0.25rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "monospace" }}>{line.item?.code}</span>
                        {line.day_of_week != null && <span>📅 {DAYS[line.day_of_week]}</span>}
                        <span>{line.demand_type.replace("_", " ")}</span>
                        {isFixed
                          ? <span>{line.planned_units ?? "?"} units</span>
                          : <span>{line.planned_qty_kg ?? "?"} kg</span>
                        }
                      </div>
                    </div>

                    {/* Inline dispatch form */}
                    {!isDone && (
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
                        <div>
                          <label className="form-label" style={{ fontSize: "0.6875rem" }}>Date</label>
                          <input className="form-input" type="date" style={{ width: "130px", fontSize: "0.8125rem" }}
                            value={d.dispatch_date}
                            onChange={e => setField(line.id, "dispatch_date", e.target.value, line)} />
                        </div>
                        {isFixed ? (
                          <div>
                            <label className="form-label" style={{ fontSize: "0.6875rem" }}>Units</label>
                            <input className="form-input" type="number" step="1" style={{ width: "80px", fontSize: "0.8125rem" }}
                              value={d.qty_units}
                              onChange={e => setField(line.id, "qty_units", e.target.value, line)} />
                          </div>
                        ) : (
                          <div>
                            <label className="form-label" style={{ fontSize: "0.6875rem" }}>kg</label>
                            <input className="form-input" type="number" step="0.1" style={{ width: "80px", fontSize: "0.8125rem" }}
                              value={d.qty_kg}
                              onChange={e => setField(line.id, "qty_kg", e.target.value, line)} />
                          </div>
                        )}
                        <div>
                          <label className="form-label" style={{ fontSize: "0.6875rem" }}>Customer</label>
                          <input className="form-input" style={{ width: "130px", fontSize: "0.8125rem" }} placeholder="Customer name"
                            value={d.customer_name}
                            onChange={e => setField(line.id, "customer_name", e.target.value, line)} />
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: "0.6875rem" }}>Ref</label>
                          <input className="form-input" style={{ width: "90px", fontSize: "0.8125rem" }} placeholder="Order ref"
                            value={d.customer_ref}
                            onChange={e => setField(line.id, "customer_ref", e.target.value, line)} />
                        </div>
                        <button
                          onClick={() => handleDispatch(line)}
                          disabled={isPending}
                          style={{ background: "#166534", color: "white", border: "none", borderRadius: "0.375rem", padding: "0.5rem 0.875rem", cursor: "pointer", fontWeight: "600", fontSize: "0.8125rem", whiteSpace: "nowrap" }}
                        >
                          🚚 Dispatch
                        </button>
                      </div>
                    )}

                    {msg[line.id] && (
                      <span style={{ fontSize: "0.8125rem", color: msg[line.id].includes("✓") ? "#166534" : "#dc2626", alignSelf: "center" }}>
                        {msg[line.id]}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent dispatches */}
      {recentDispatches.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4" }}>
            <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: "600" }}>Recent Dispatches</h2>
          </div>
          <table className="data-table" style={{ fontSize: "0.8125rem" }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Customer</th>
                <th>Ref</th>
              </tr>
            </thead>
            <tbody>
              {recentDispatches.map(r => (
                <tr key={r.id}>
                  <td>{new Date(r.dispatch_date).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</td>
                  <td>
                    <div style={{ fontWeight: "500" }}>{r.item?.name ?? "—"}</div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{r.item?.code}</div>
                  </td>
                  <td>{r.qty_units ? `${r.qty_units} ea` : r.qty_kg ? `${r.qty_kg} kg` : "—"}</td>
                  <td style={{ color: "#78716c" }}>{r.customer_name ?? "—"}</td>
                  <td style={{ fontFamily: "monospace", color: "#78716c" }}>{r.customer_ref ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
