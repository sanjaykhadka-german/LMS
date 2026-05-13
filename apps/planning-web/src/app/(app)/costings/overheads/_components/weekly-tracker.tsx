"use client";

/**
 * Weekly overhead actuals editor.
 *
 * One week at a time. Add/edit line items by category + amount; set the
 * kg-produced denominator; the page derives this week's real $/kg. The
 * standard rate above uses these as a 4-week average suggestion.
 *
 * Save is bulk-replace for the selected week: delete removed rows,
 * upsert kept/new rows. UPSERT on (tenant_id, week_start_date, category)
 * means renaming a category twice in one save would collide — same
 * pattern as routings, well-trodden.
 */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type LineRow = {
  id: string | null;
  category: string;
  amount: string;          // string for input binding
  notes: string;
  _tempKey: string;
};

export type RecentWeekRow = {
  week_start_date: string;
  total_oh: number;
  kg_produced: number | null;
  derived_dollars_per_kg: number | null;
};

const CATEGORY_SUGGESTIONS = [
  "Rent", "Insurance", "Council rates", "Power", "Gas", "Water",
  "Freezer power", "Cleaning", "Pest control", "Admin labour",
  "Software / subscriptions", "Depreciation", "Maintenance", "Other",
];

function fmtMoney(v: number | null | undefined, dp = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return "$" + v.toLocaleString("en-AU", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function mondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function shiftWeek(iso: string, dWeeks: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + dWeeks * 7);
  return d.toISOString().slice(0, 10);
}

let tempCounter = 0;
function newTempKey(): string { tempCounter += 1; return `_new_${Date.now()}_${tempCounter}`; }

export default function WeeklyTracker({
  initialWeek, recentWeeks,
}: {
  initialWeek: string;
  recentWeeks: RecentWeekRow[];
}) {
  const supabase = createClient();

  const [week, setWeek] = useState<string>(mondayOf(initialWeek));
  const [lines, setLines] = useState<LineRow[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [kgProduced, setKgProduced] = useState<string>("");
  const [kgRowId, setKgRowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // ── Fetch the selected week's actuals + kg whenever the week changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null); setSaved(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (!cancelled) { setError("Not signed in"); setLoading(false); } return; }
      const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user.id).single();
      if (!profile?.tenant_id) { if (!cancelled) { setError("No tenant on profile"); setLoading(false); } return; }

      const [actualsRes, kgRes] = await Promise.all([
        supabase.from("overhead_actuals")
          .select("id, category, amount, notes")
          .eq("tenant_id", profile.tenant_id)
          .eq("week_start_date", week)
          .order("category"),
        supabase.from("overhead_week_kg")
          .select("id, kg_produced")
          .eq("tenant_id", profile.tenant_id)
          .eq("week_start_date", week)
          .maybeSingle(),
      ]);

      if (cancelled) return;
      if (actualsRes.error) { setError(actualsRes.error.message); setLoading(false); return; }

      setLines((actualsRes.data ?? []).map((r: { id: string; category: string; amount: number | string; notes: string | null }) => ({
        id: r.id,
        category: r.category,
        amount: String(r.amount),
        notes: r.notes ?? "",
        _tempKey: r.id,
      })));
      setDeletedIds([]);
      setKgProduced(kgRes?.data?.kg_produced != null ? String(kgRes.data.kg_produced) : "");
      setKgRowId(kgRes?.data?.id ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [week, supabase]);

  // ── Derived totals.
  const totals = useMemo(() => {
    const totalOh = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const kg      = Number(kgProduced) || 0;
    const derived = kg > 0 ? totalOh / kg : null;
    return { totalOh, kg, derived };
  }, [lines, kgProduced]);

  // ── Row ops.
  function update(key: string, patch: Partial<LineRow>) {
    setLines(prev => prev.map(l => l._tempKey === key ? { ...l, ...patch } : l));
    setSaved(false);
  }
  function addLine() {
    setLines(prev => [...prev, { id: null, category: "", amount: "", notes: "", _tempKey: newTempKey() }]);
    setSaved(false);
  }
  function removeLine(key: string) {
    setLines(prev => {
      const removed = prev.find(l => l._tempKey === key);
      if (removed?.id) setDeletedIds(d => [...d, removed.id!]);
      return prev.filter(l => l._tempKey !== key);
    });
    setSaved(false);
  }

  async function save() {
    setError(null); setSaving(true);

    // Validation
    for (const l of lines) {
      if (!l.category.trim()) { setError("Every line needs a category."); setSaving(false); return; }
      if (Number(l.amount) < 0) { setError(`"${l.category}": amount can't be negative.`); setSaving(false); return; }
    }
    // No duplicate categories within the same week.
    const seen = new Set<string>();
    for (const l of lines) {
      const cat = l.category.trim().toLowerCase();
      if (seen.has(cat)) { setError(`Duplicate category: "${l.category}". One row per category per week.`); setSaving(false); return; }
      seen.add(cat);
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not signed in"); setSaving(false); return; }
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user.id).single();
    if (!profile?.tenant_id) { setError("No tenant on profile"); setSaving(false); return; }

    // 1) Delete removed rows.
    if (deletedIds.length > 0) {
      const { error: dErr } = await supabase.from("overhead_actuals").delete().in("id", deletedIds);
      if (dErr) { setError(`Delete failed: ${dErr.message}`); setSaving(false); return; }
    }

    // 2) Upsert remaining lines (UPSERT by (tenant_id, week, category)).
    if (lines.length > 0) {
      const payload = lines.map(l => ({
        ...(l.id ? { id: l.id } : {}),
        tenant_id: profile.tenant_id,
        week_start_date: week,
        category: l.category.trim(),
        amount: Number(l.amount) || 0,
        notes: l.notes.trim() || null,
        created_by: user.id,
      }));
      const { error: uErr } = await supabase
        .from("overhead_actuals")
        .upsert(payload, { onConflict: "tenant_id,week_start_date,category" });
      if (uErr) { setError(`Save failed: ${uErr.message}`); setSaving(false); return; }
    }

    // 3) Kg produced — upsert or clear.
    if (kgProduced && Number(kgProduced) > 0) {
      const { error: kErr } = await supabase
        .from("overhead_week_kg")
        .upsert({
          ...(kgRowId ? { id: kgRowId } : {}),
          tenant_id: profile.tenant_id,
          week_start_date: week,
          kg_produced: Number(kgProduced),
          created_by: user.id,
        }, { onConflict: "tenant_id,week_start_date" });
      if (kErr) { setError(`Kg save failed: ${kErr.message}`); setSaving(false); return; }
    } else if (kgRowId) {
      // User cleared kg — delete the row.
      await supabase.from("overhead_week_kg").delete().eq("id", kgRowId);
      setKgRowId(null);
    }

    setSaving(false); setSaved(true);
    setDeletedIds([]);
  }

  return (
    <div className="card" style={{ padding: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "0.75rem", gap: "1rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700 }}>
          Weekly actuals
        </h2>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
          <button type="button" onClick={() => setWeek(w => shiftWeek(w, -1))} className="btn-secondary" style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }} title="Previous week">‹</button>
          <input
            type="date"
            value={week}
            onChange={e => setWeek(mondayOf(e.target.value))}
            className="form-input"
            style={{ fontSize: "0.8125rem", fontFamily: "monospace", width: 160 }}
            title="Pick a Monday — the page snaps to Monday of whatever date you choose"
          />
          <button type="button" onClick={() => setWeek(w => shiftWeek(w,  1))} className="btn-secondary" style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }} title="Next week">›</button>
          <span style={{ fontSize: "0.7rem", color: "#78716c", marginLeft: "0.25rem" }}>
            Week of <strong style={{ color: "#1c1917", fontFamily: "monospace" }}>{week}</strong>
          </span>
        </div>
      </div>

      {error && (
        <div style={{ padding: "0.5rem 0.75rem", marginBottom: "0.625rem", background: "#fee2e2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: "0.375rem", fontSize: "0.8125rem" }}>{error}</div>
      )}
      {saved && !error && (
        <div style={{ padding: "0.4rem 0.75rem", marginBottom: "0.625rem", background: "#dcfce7", border: "1px solid #bbf7d0", color: "#166534", borderRadius: "0.375rem", fontSize: "0.8125rem" }}>Saved.</div>
      )}

      {/* Line items */}
      <table className="data-table" style={{ fontSize: "0.8125rem" }}>
        <thead>
          <tr>
            <th style={{ width: "26%" }}>Category</th>
            <th style={{ width: 140, textAlign: "right" }}>Amount</th>
            <th>Notes</th>
            <th style={{ width: 50 }}></th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={4} style={{ textAlign: "center", padding: "0.75rem", color: "#a8a29e" }}>Loading…</td></tr>
          )}
          {!loading && lines.length === 0 && (
            <tr><td colSpan={4} style={{ textAlign: "center", padding: "1rem", color: "#a8a29e", fontStyle: "italic" }}>
              No entries for this week yet. Click &quot;+ Add line&quot; to start.
            </td></tr>
          )}
          {lines.map(l => (
            <tr key={l._tempKey}>
              <td>
                <input
                  className="form-input"
                  list="overhead-categories"
                  value={l.category}
                  onChange={e => update(l._tempKey, { category: e.target.value })}
                  placeholder="e.g. Rent"
                  style={{ fontSize: "0.8125rem", width: "100%" }}
                />
              </td>
              <td>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: "0.5rem", top: "50%", transform: "translateY(-50%)", color: "#78716c", fontFamily: "monospace", fontSize: "0.8125rem" }}>$</span>
                  <input
                    type="text" inputMode="decimal" pattern="[0-9.]*"
                    className="form-input"
                    value={l.amount}
                    onChange={e => update(l._tempKey, { amount: e.target.value })}
                    style={{ fontSize: "0.8125rem", fontFamily: "monospace", textAlign: "right", width: "100%", paddingLeft: "1.4rem" }}
                  />
                </div>
              </td>
              <td>
                <input
                  className="form-input"
                  placeholder="optional"
                  value={l.notes}
                  onChange={e => update(l._tempKey, { notes: e.target.value })}
                  style={{ fontSize: "0.8125rem", width: "100%" }}
                />
              </td>
              <td>
                <button type="button" onClick={() => removeLine(l._tempKey)} style={{ background: "transparent", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: "0.3rem", padding: "0.2rem 0.5rem", cursor: "pointer", fontSize: "0.75rem" }} title="Remove">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id="overhead-categories">
        {CATEGORY_SUGGESTIONS.map(c => <option key={c} value={c} />)}
      </datalist>

      <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <button type="button" onClick={addLine} className="btn-secondary">+ Add line</button>
        <button type="button" onClick={save} disabled={saving || loading} className="btn-primary" style={{ marginLeft: "auto" }}>
          {saving ? "Saving…" : "Save week"}
        </button>
      </div>

      {/* Totals row */}
      <div style={{ marginTop: "1rem", padding: "0.75rem 0.875rem", background: "#fafaf9", borderRadius: "0.4rem", display: "flex", gap: "1.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "0.7rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>Total OH this week</div>
          <div style={{ fontSize: "1.1rem", fontFamily: "monospace", fontWeight: 700 }}>{fmtMoney(totals.totalOh, 2)}</div>
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.7rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
            Kg produced this week
          </label>
          <input
            type="text" inputMode="decimal" pattern="[0-9.]*"
            className="form-input"
            value={kgProduced}
            onChange={e => { setKgProduced(e.target.value); setSaved(false); }}
            placeholder="e.g. 12000"
            style={{ width: 140, fontFamily: "monospace", fontSize: "0.95rem", textAlign: "right" }}
          />
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: "0.7rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>Derived $/kg</div>
          <div style={{ fontSize: "1.4rem", fontFamily: "monospace", fontWeight: 700, color: totals.derived != null ? "#166534" : "#a8a29e" }}>
            {totals.derived != null ? fmtMoney(totals.derived, 4) : "—"}
            <span style={{ fontSize: "0.7rem", color: "#78716c", fontWeight: 400 }}> /kg</span>
          </div>
        </div>
      </div>

      {/* Recent weeks mini-trend (read-only) */}
      {recentWeeks.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", fontWeight: 700, color: "#57534e" }}>Recent weeks</h3>
          <table style={{ width: "100%", fontSize: "0.75rem" }}>
            <thead>
              <tr style={{ color: "#78716c", textAlign: "left" }}>
                <th style={{ padding: "0.2rem 0.4rem" }}>Week of</th>
                <th style={{ padding: "0.2rem 0.4rem", textAlign: "right" }}>Total OH</th>
                <th style={{ padding: "0.2rem 0.4rem", textAlign: "right" }}>Kg</th>
                <th style={{ padding: "0.2rem 0.4rem", textAlign: "right" }}>$/kg</th>
              </tr>
            </thead>
            <tbody>
              {recentWeeks.map(r => (
                <tr key={r.week_start_date} style={r.week_start_date === week ? { background: "#fefce8" } : undefined}>
                  <td style={{ padding: "0.2rem 0.4rem", fontFamily: "monospace" }}>
                    <button
                      type="button"
                      onClick={() => setWeek(r.week_start_date)}
                      style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer", color: "#b91c1c", fontFamily: "monospace", fontSize: "0.75rem", textDecoration: "underline" }}
                      title="Jump to this week"
                    >
                      {r.week_start_date}
                    </button>
                  </td>
                  <td style={{ padding: "0.2rem 0.4rem", textAlign: "right", fontFamily: "monospace" }}>{fmtMoney(r.total_oh, 2)}</td>
                  <td style={{ padding: "0.2rem 0.4rem", textAlign: "right", fontFamily: "monospace", color: r.kg_produced == null ? "#a8a29e" : undefined }}>
                    {r.kg_produced != null ? r.kg_produced.toLocaleString("en-AU") : "—"}
                  </td>
                  <td style={{ padding: "0.2rem 0.4rem", textAlign: "right", fontFamily: "monospace", color: r.derived_dollars_per_kg != null ? "#166534" : "#a8a29e", fontWeight: 600 }}>
                    {r.derived_dollars_per_kg != null ? fmtMoney(r.derived_dollars_per_kg, 4) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
