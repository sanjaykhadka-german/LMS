"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type RateRow = {
  id: string;
  effective_from: string;
  hourly_rate: number;
  notes: string;
};

function fmtMoney(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "—";
  return "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LabourRateEditor({
  currentRate, currentNotes, currentEffectiveFrom, history,
}: {
  currentRate: number;
  currentNotes: string;
  currentEffectiveFrom: string | null;
  history: RateRow[];
}) {
  const supabase = createClient();
  const router = useRouter();

  const [rate, setRate]     = useState<string>(String(currentRate || ""));
  const [notes, setNotes]   = useState<string>(currentNotes);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const dirty = Number(rate) !== Number(currentRate) || (notes ?? "") !== (currentNotes ?? "");

  async function save() {
    if (rate === "" || isNaN(Number(rate)) || Number(rate) < 0) {
      setError("Enter a valid hourly rate (>= 0).");
      return;
    }
    setSaving(true); setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not signed in"); setSaving(false); return; }
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user.id).single();
    if (!profile?.tenant_id) { setError("No tenant on profile"); setSaving(false); return; }

    const today = new Date().toISOString().slice(0, 10);
    const payload = {
      tenant_id:      profile.tenant_id,
      effective_from: today,
      hourly_rate:    Number(rate),
      notes:          notes.trim() || null,
      created_by:     user.id,
    };

    // UPSERT on (tenant_id, effective_from): editing today's rate updates
    // the same row; tomorrow's edit creates a fresh one.
    const { error: err } = await supabase
      .from("labour_rates")
      .upsert(payload, { onConflict: "tenant_id,effective_from" });

    setSaving(false);
    if (err) { setError(err.message); return; }
    router.refresh();
  }

  return (
    <div>
      {error && (
        <div style={{
          padding: "0.5rem 0.75rem", marginBottom: "0.625rem",
          background: "#fee2e2", border: "1px solid #fecaca",
          color: "#991b1b", borderRadius: "0.375rem", fontSize: "0.8125rem",
        }}>{error}</div>
      )}

      {/* Single-rate editor card */}
      <div className="card" style={{ padding: "1.25rem", marginBottom: "1rem" }}>
        <h2 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 700 }}>
          Standard hourly labour rate
        </h2>

        <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.7rem", color: "#78716c", marginBottom: "0.25rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              $/hour
            </label>
            <div style={{ position: "relative", display: "inline-block" }}>
              <span style={{ position: "absolute", left: "0.6rem", top: "50%", transform: "translateY(-50%)", color: "#78716c", fontFamily: "monospace", fontSize: "1rem" }}>$</span>
              <input
                type="number" step="0.01" min="0"
                className="form-input"
                value={rate}
                onChange={e => setRate(e.target.value)}
                placeholder="40.00"
                style={{ width: 160, paddingLeft: "1.4rem", fontFamily: "monospace", fontSize: "1.1rem", textAlign: "right" }}
              />
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 240 }}>
            <label style={{ display: "block", fontSize: "0.7rem", color: "#78716c", marginBottom: "0.25rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Notes (optional)
            </label>
            <input
              className="form-input"
              placeholder="e.g. post-EBA increase, 2026 review"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              style={{ width: "100%", fontSize: "0.8125rem" }}
            />
          </div>

          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="btn-primary"
            style={{ opacity: dirty ? 1 : 0.5, cursor: dirty ? "pointer" : "default" }}
            title={dirty ? "Save — creates today's row, or updates if you've already saved today" : "No pending changes"}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        {currentEffectiveFrom && (
          <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "#78716c" }}>
            Currently effective from <strong style={{ color: "#1c1917", fontFamily: "monospace" }}>{currentEffectiveFrom}</strong>
            {currentNotes && <> — <em>{currentNotes}</em></>}
          </div>
        )}

        <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "#a8a29e" }}>
          Used by the routing math: <code style={{ background: "#fafaf9", padding: "0 0.3rem", borderRadius: 3, fontFamily: "monospace" }}>
            step $/kg = (people × min ÷ 60) × hourly_rate ÷ reference_qty
          </code>
        </div>
      </div>

      {/* History */}
      <div className="card" style={{ padding: "0.75rem 1.25rem" }}>
        <button
          type="button"
          onClick={() => setHistoryOpen(o => !o)}
          style={{
            background: "transparent", border: 0, padding: 0, cursor: "pointer",
            fontSize: "0.85rem", fontWeight: 600, color: "#1c1917", display: "inline-flex", alignItems: "center", gap: "0.4rem",
          }}
        >
          {historyOpen ? "▾" : "▸"} History
          <span style={{ color: "#78716c", fontWeight: 400, fontSize: "0.75rem" }}>({history.length} {history.length === 1 ? "entry" : "entries"})</span>
        </button>

        {historyOpen && history.length > 0 && (
          <table style={{ width: "100%", marginTop: "0.5rem", fontSize: "0.8125rem" }}>
            <thead>
              <tr style={{ color: "#78716c", textAlign: "left" }}>
                <th style={{ padding: "0.3rem 0.4rem", width: "20%" }}>Effective from</th>
                <th style={{ padding: "0.3rem 0.4rem", width: "20%", textAlign: "right" }}>$/hour</th>
                <th style={{ padding: "0.3rem 0.4rem" }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={h.id} style={i === 0 ? { background: "#fefce8" } : undefined}>
                  <td style={{ padding: "0.3rem 0.4rem", fontFamily: "monospace" }}>{h.effective_from}</td>
                  <td style={{ padding: "0.3rem 0.4rem", textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{fmtMoney(h.hourly_rate)}</td>
                  <td style={{ padding: "0.3rem 0.4rem", color: "#57534e" }}>{h.notes ?? <span style={{ color: "#a8a29e" }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {historyOpen && history.length === 0 && (
          <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#a8a29e" }}>
            No history yet — first save creates today&apos;s row.
          </div>
        )}
      </div>
    </div>
  );
}
