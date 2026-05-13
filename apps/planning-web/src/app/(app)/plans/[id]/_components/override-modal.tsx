"use client";

/**
 * OverrideModal — emergency-release-valve modal for MRP overrides.
 *
 * Opens from a row in any dept-card materials list (or the production scheduler).
 * Captures: new qty + reason. Saves to mrp_overrides via server action and
 * re-explodes MRP so the override applies immediately.
 *
 * Design choices:
 *  - Reason is REQUIRED (per Tino) so the audit trail is meaningful.
 *  - Per (item, dept, plan) — same item in another dept stays untouched.
 *  - Cascade re-flows downstream raw materials — see migration 117.
 */

import { useState, useTransition } from "react";
import { saveOverride } from "../../actions";

export type OverrideTarget = {
  plan_id:       string;
  item_id:       string;
  item_code:     string;
  item_name:     string;
  department:    string;
  current_qty:   number;
  unit:          string;
};

const COMMON_REASONS = [
  "BOM data bug — see ticket",
  "Actual production lower than plan",
  "Stocktake variance",
  "Customer change after MRP",
  "Bulk re-purpose between products",
  "Other",
];

export default function OverrideModal({
  target, onClose,
}: {
  target: OverrideTarget;
  onClose: () => void;
}) {
  const [qty, setQty]               = useState(String(target.current_qty));
  const [reasonChoice, setReasonChoice] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [pending, start]            = useTransition();
  const [err, setErr]               = useState<string | null>(null);

  function handleSave() {
    setErr(null);
    const finalReason = reasonChoice && reasonChoice !== "Other" ? reasonChoice : reasonText.trim();
    if (!finalReason || finalReason.length < 3) {
      setErr("A reason is required (min 3 chars). This is part of the audit trail.");
      return;
    }
    const numQty = Number(qty);
    if (Number.isNaN(numQty) || numQty < 0) {
      setErr("Override qty must be a number ≥ 0.");
      return;
    }
    start(async () => {
      const res = await saveOverride({
        plan_id:      target.plan_id,
        item_id:      target.item_id,
        department:   target.department,
        override_qty: numQty,
        reason:       finalReason,
      });
      if ("error" in res) { setErr(res.error); return; }
      onClose();
    });
  }

  const delta = Number(qty) - target.current_qty;
  const showDelta = !Number.isNaN(Number(qty)) && qty.trim() !== "";

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
          <div>
            <div style={lblTiny}>Manual override</div>
            <h2 style={{ margin: "0.2rem 0 0.1rem", fontSize: "1.0625rem", fontWeight: 700 }}>{target.item_name}</h2>
            <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#78716c" }}>
              {target.item_code} · {target.department}
            </div>
          </div>
          <button onClick={onClose} style={{ border: 0, background: "transparent", fontSize: "1.5rem", cursor: "pointer", color: "#78716c", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "0.4rem", padding: "0.6rem 0.75rem", fontSize: "0.75rem", color: "#854d0e", marginBottom: "0.875rem" }}>
          The MRP cascade currently computes <strong style={{ fontFamily: "monospace" }}>{fmt(target.current_qty)} {target.unit}</strong> for this item in {target.department}.
          Your override replaces that figure for this department only — raw materials downstream will recompute from the new qty. Other departments using this item are not affected.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.875rem" }}>
          <Field label={`Override qty (${target.unit})`}>
            <input
              type="number" step="any" value={qty}
              onChange={e => setQty(e.target.value)}
              autoFocus
              style={input}
            />
            {showDelta && (
              <div style={{ marginTop: "0.25rem", fontSize: "0.7rem", color: delta < 0 ? "#166534" : delta > 0 ? "#9a3412" : "#78716c" }}>
                {delta === 0 ? "(same as MRP)" : `${delta > 0 ? "+" : ""}${fmt(delta)} ${target.unit} vs MRP`}
              </div>
            )}
          </Field>
          <Field label="Reason for override *">
            <select value={reasonChoice} onChange={e => setReasonChoice(e.target.value)} style={input}>
              <option value="">— Pick a reason —</option>
              {COMMON_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonChoice === "Other" && (
              <input
                type="text" value={reasonText}
                onChange={e => setReasonText(e.target.value)}
                placeholder="Type the reason…"
                style={{ ...input, marginTop: "0.3rem" }}
              />
            )}
          </Field>
        </div>

        {err && <div style={{ color: "#dc2626", fontSize: "0.8125rem", margin: "0.5rem 0" }}>{err}</div>}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem" }}>
          <span style={{ fontSize: "0.7rem", color: "#a8a29e" }}>
            An admin can review and clear this override later.
          </span>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button onClick={onClose} className="btn-secondary" style={{ padding: "0.45rem 0.875rem", fontSize: "0.8125rem" }}>Cancel</button>
            <button onClick={handleSave} disabled={pending} className="btn-primary" style={{ padding: "0.45rem 1rem", fontSize: "0.8125rem" }}>
              {pending ? "Saving…" : "Save override"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#57534e", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      {children}
    </label>
  );
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  paddingTop: "5vh", overflowY: "auto",
};
const panel: React.CSSProperties = {
  background: "white", borderRadius: "0.625rem",
  width: "min(620px, 95vw)", padding: "1.5rem 1.75rem",
  boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
};
const input: React.CSSProperties = {
  width: "100%", padding: "0.4rem 0.625rem",
  border: "1px solid #cfc9bf", borderRadius: "0.375rem",
  fontSize: "0.8125rem", fontFamily: "inherit", background: "white",
};
const lblTiny: React.CSSProperties = {
  fontSize: "0.7rem", color: "#78716c", letterSpacing: "0.04em",
  textTransform: "uppercase", fontWeight: 600,
};
