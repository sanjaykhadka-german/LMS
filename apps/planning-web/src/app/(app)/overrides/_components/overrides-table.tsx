"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { clearOverride } from "../../plans/actions";

export type OverrideRow = {
  id:            string;
  plan_id:       string;
  plan_week:     string;
  plan_status:   string;
  item_id:       string;
  item_code:     string;
  item_name:     string;
  item_unit:     string;
  department:    string;
  override_qty:  number;
  reason:        string;
  overridden_by: string | null;
  overridden_at: string;
  resolved_at:   string | null;
  resolved_by:   string | null;
  resolved_note: string | null;
};

export default function OverridesTable({
  rows, mode,
}: {
  rows: OverrideRow[];
  mode: "active" | "resolved";
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleClear(id: string) {
    const note = prompt("Resolution note (optional — what changed in the BOM/data so this override is no longer needed):");
    if (note === null) return; // user cancelled
    setErr(null);
    start(async () => {
      const res = await clearOverride({ override_id: id, resolved_note: note || undefined });
      if ("error" in res) setErr(res.error);
    });
  }

  if (rows.length === 0) {
    return (
      <div className="card" style={{ padding: "1.25rem", textAlign: "center", color: "#78716c", fontSize: "0.875rem" }}>
        {mode === "active" ? "No active overrides — everything is running off the MRP cascade." : "No resolved overrides yet."}
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      {err && <div style={{ color: "#dc2626", fontSize: "0.8125rem", padding: "0.5rem 1rem" }}>{err}</div>}
      <table style={{ width: "100%", fontSize: "0.8125rem", borderCollapse: "collapse" }}>
        <thead style={{ background: "#fafaf9" }}>
          <tr>
            <th style={th}>Plan</th>
            <th style={th}>Item</th>
            <th style={th}>Dept</th>
            <th style={{ ...th, textAlign: "right" }}>Override qty</th>
            <th style={th}>Reason</th>
            <th style={th}>Overridden at</th>
            {mode === "resolved" && <th style={th}>Resolved at</th>}
            {mode === "resolved" && <th style={th}>Resolved note</th>}
            {mode === "active" && <th></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} style={{ borderTop: "1px solid #f5f5f4" }}>
              <td style={td}>
                <Link href={`/plans/${r.plan_id}`} style={{ color: "#b91c1c", textDecoration: "none", fontSize: "0.75rem" }}>
                  {r.plan_week ? new Date(r.plan_week).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "—"}
                </Link>
                <div style={{ fontSize: "0.65rem", color: "#a8a29e" }}>{r.plan_status}</div>
              </td>
              <td style={td}>
                <Link href={`/items/${r.item_id}`} style={{ color: "#1c1917", textDecoration: "none", fontWeight: 500 }}>
                  {r.item_name}
                </Link>
                <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: "#a8a29e" }}>{r.item_code}</div>
              </td>
              <td style={td}>
                <span style={{ padding: "0.1rem 0.45rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "999px", fontSize: "0.7rem" }}>
                  {r.department}
                </span>
              </td>
              <td style={{ ...td, textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>
                {fmt(r.override_qty)} {r.item_unit}
              </td>
              <td style={td}>{r.reason}</td>
              <td style={td}>
                <span style={{ fontSize: "0.7rem", color: "#57534e" }}>
                  {new Date(r.overridden_at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                </span>
              </td>
              {mode === "resolved" && (
                <td style={td}>
                  <span style={{ fontSize: "0.7rem", color: "#57534e" }}>
                    {r.resolved_at && new Date(r.resolved_at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                  </span>
                </td>
              )}
              {mode === "resolved" && (
                <td style={td}>
                  <span style={{ fontSize: "0.7rem", color: "#57534e" }}>{r.resolved_note ?? "—"}</span>
                </td>
              )}
              {mode === "active" && (
                <td style={{ ...td, textAlign: "right" }}>
                  <button
                    onClick={() => handleClear(r.id)}
                    disabled={pending}
                    className="btn-secondary"
                    style={{ fontSize: "0.7rem", padding: "0.25rem 0.6rem" }}
                  >
                    Clear
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const th: React.CSSProperties = {
  padding: "0.5rem 0.75rem", textAlign: "left",
  fontSize: "0.65rem", color: "#78716c",
  textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600,
};
const td: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  verticalAlign: "top",
};
