"use client";

/**
 * SplitOrderModal — break one work order into N parts so the qty can run
 * across multiple days.
 *
 * Use case: 15,000 kg of Hocks scheduled all on Monday → split into
 * 5,000 / 5,000 / 5,000 across Mon / Tue / Wed for JIT production.
 *
 * Each split inherits the original's item / dept / plan and gets its own
 * production_date + qty + batch_number suffix (".1", ".2", ".3"). After
 * save, dept scheduler shows N cards — each independently draggable,
 * batch-sizable, overridable.
 */

import { useState, useTransition } from "react";
import { splitProductionOrder } from "../../actions";

export type SplitOrderTarget = {
  order_id:      string;
  item_code:     string;
  item_name:     string;
  department:    string;
  current_qty:   number;
  unit:          string;
  current_date:  string | null; // ISO date or null for unscheduled
  week_dates:    string[];      // 7 ISO dates Mon..Sun for the plan's week
};

type Split = { key: string; qty: string; date: string };

const UNSCHEDULED = "";  // sentinel for the date dropdown

export default function SplitOrderModal({
  target, onClose,
}: {
  target: SplitOrderTarget;
  onClose: () => void;
}) {
  // Default: 2 splits of half the qty, both on the original's date.
  const initial: Split[] = (() => {
    const half = target.current_qty / 2;
    return [
      { key: rid(), qty: trimNum(half), date: target.current_date ?? UNSCHEDULED },
      { key: rid(), qty: trimNum(half), date: target.current_date ?? UNSCHEDULED },
    ];
  })();

  const [splits, setSplits] = useState<Split[]>(initial);
  const [pending, start]    = useTransition();
  const [err, setErr]       = useState<string | null>(null);

  const total = splits.reduce((s, x) => s + (Number(x.qty) || 0), 0);
  const diff = total - target.current_qty;
  const sumOk = Math.abs(diff) < 0.01;

  function update(key: string, patch: Partial<Split>) {
    setSplits(prev => prev.map(s => s.key === key ? { ...s, ...patch } : s));
  }
  function add() {
    if (splits.length >= 7) { setErr("Max 7 splits (one per day of the week)."); return; }
    setSplits(prev => [...prev, { key: rid(), qty: "0", date: UNSCHEDULED }]);
  }
  function remove(key: string) {
    if (splits.length <= 2) { setErr("Need at least 2 splits — to keep the original use Cancel."); return; }
    setSplits(prev => prev.filter(s => s.key !== key));
  }
  function equalSplit() {
    setErr(null);
    const each = target.current_qty / splits.length;
    setSplits(prev => prev.map(s => ({ ...s, qty: trimNum(each) })));
  }
  function spreadAcrossWeek() {
    setErr(null);
    const days = target.week_dates.slice(0, splits.length);
    setSplits(prev => prev.map((s, i) => ({ ...s, date: days[i] ?? UNSCHEDULED })));
  }

  async function handleSave() {
    setErr(null);
    const valid = splits.filter(s => Number(s.qty) > 0);
    if (valid.length < 2) { setErr("At least 2 splits with qty > 0."); return; }
    if (!sumOk && !confirm(
      `Splits sum to ${trimNum(total)} ${target.unit}, but the original was ${trimNum(target.current_qty)} ${target.unit} ` +
      `(${diff > 0 ? "+" : ""}${trimNum(diff)} ${target.unit} difference).\n\n` +
      `Save anyway? Use the Override modal afterwards if you want to record the qty change.`
    )) return;

    start(async () => {
      const res = await splitProductionOrder(
        target.order_id,
        valid.map(s => ({
          qty: Number(s.qty),
          production_date: s.date === UNSCHEDULED ? null : s.date,
        })),
      );
      if ("error" in res) { setErr(res.error); return; }
      onClose();
    });
  }

  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
          <div>
            <div style={lblTiny}>Split work order</div>
            <h2 style={{ margin: "0.2rem 0 0.1rem", fontSize: "1.0625rem", fontWeight: 700 }}>{target.item_name}</h2>
            <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#78716c" }}>
              {target.item_code} · {target.department} · originally <strong>{trimNum(target.current_qty)} {target.unit}</strong>
            </div>
          </div>
          <button onClick={onClose} style={{ border: 0, background: "transparent", fontSize: "1.5rem", cursor: "pointer", color: "#78716c", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "0.4rem", padding: "0.5rem 0.75rem", fontSize: "0.7rem", color: "#854d0e", marginBottom: "0.875rem" }}>
          Each split becomes its own work order. Materials downstream will recompute per day so you can see "what we need by Monday" in the JIT view.
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <span style={lblTiny}>Splits ({splits.length})</span>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button type="button" onClick={equalSplit} style={btnGhost}>Equal split</button>
            <button type="button" onClick={spreadAcrossWeek} style={btnGhost}>Spread Mon→Sun</button>
            <button type="button" onClick={add} style={btnGhost}>+ Add</button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {splits.map((s, idx) => (
            <div key={s.key} style={{ display: "grid", gridTemplateColumns: "30px 1fr 160px 36px", gap: "0.5rem", alignItems: "center", padding: "0.4rem 0.625rem", border: "1px solid #e7e5e4", borderRadius: "0.4rem" }}>
              <span style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#78716c" }}>{`#${idx + 1}`}</span>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                <span style={miniLabel}>Qty ({target.unit})</span>
                <input type="number" step="any" min="0" value={s.qty} onChange={e => update(s.key, { qty: e.target.value })} style={input} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                <span style={miniLabel}>Day</span>
                <select value={s.date} onChange={e => update(s.key, { date: e.target.value })} style={input}>
                  <option value={UNSCHEDULED}>Unscheduled</option>
                  {target.week_dates.map((d, i) => (
                    <option key={d} value={d}>
                      {dayLabels[i]} · {new Date(d + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => remove(s.key)}
                disabled={splits.length <= 2}
                title={splits.length <= 2 ? "Need at least 2 splits" : "Remove this split"}
                style={{ border: "1px solid #e7e5e4", background: splits.length <= 2 ? "#fafaf9" : "white", color: splits.length <= 2 ? "#cfc9bf" : "#dc2626", borderRadius: "0.375rem", cursor: splits.length <= 2 ? "not-allowed" : "pointer", padding: "0.25rem 0", fontSize: "0.875rem", fontFamily: "inherit" }}
              >×</button>
            </div>
          ))}
        </div>

        {/* Total bar */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem", padding: "0.5rem 0.75rem", background: sumOk ? "#f0fdf4" : "#fef2f2", border: `1px solid ${sumOk ? "#bbf7d0" : "#fca5a5"}`, borderRadius: "0.4rem", fontSize: "0.8125rem" }}>
          <span style={{ color: "#57534e" }}>
            Total: <strong style={{ fontFamily: "monospace" }}>{trimNum(total)} {target.unit}</strong> {sumOk ? "✓ matches original" : `(${diff > 0 ? "+" : ""}${trimNum(diff)} vs original)`}
          </span>
          <span style={{ color: "#78716c", fontSize: "0.7rem" }}>Original: {trimNum(target.current_qty)} {target.unit}</span>
        </div>

        {err && <div style={{ color: "#dc2626", fontSize: "0.8125rem", margin: "0.5rem 0" }}>{err}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.4rem", marginTop: "1rem" }}>
          <button onClick={onClose} className="btn-secondary" style={{ padding: "0.45rem 0.875rem", fontSize: "0.8125rem" }}>Cancel</button>
          <button onClick={handleSave} disabled={pending} className="btn-primary" style={{ padding: "0.45rem 1rem", fontSize: "0.8125rem" }}>
            {pending ? "Splitting…" : `Split into ${splits.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function trimNum(n: number): string {
  if (Math.abs(n - Math.round(n)) < 0.01) return Math.round(n).toString();
  return n.toFixed(2);
}
function rid() { return Math.random().toString(36).slice(2, 9); }

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  paddingTop: "5vh", overflowY: "auto",
};
const panel: React.CSSProperties = {
  background: "white", borderRadius: "0.625rem",
  width: "min(640px, 95vw)", padding: "1.5rem 1.75rem",
  boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
};
const input: React.CSSProperties = {
  width: "100%", padding: "0.35rem 0.5rem",
  border: "1px solid #cfc9bf", borderRadius: "0.375rem",
  fontSize: "0.8125rem", fontFamily: "inherit", background: "white",
};
const lblTiny: React.CSSProperties = {
  fontSize: "0.7rem", color: "#78716c", letterSpacing: "0.04em",
  textTransform: "uppercase", fontWeight: 600,
};
const miniLabel: React.CSSProperties = {
  fontSize: "0.6rem", color: "#78716c",
  textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600,
};
const btnGhost: React.CSSProperties = {
  padding: "0.3rem 0.6rem", border: "1px dashed #cfc9bf",
  background: "white", color: "#57534e", borderRadius: "0.375rem",
  fontSize: "0.7rem", fontFamily: "inherit", cursor: "pointer",
};
