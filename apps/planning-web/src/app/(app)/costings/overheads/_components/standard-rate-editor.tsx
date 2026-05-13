"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type StandardRateHistoryRow = {
  id: string;
  effective_from: string;
  rate_per_kg: number;
  previous_rate: number | null;
  override_reason: string;
  source: "manual" | "derived";
};

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return "$" + v.toLocaleString("en-AU", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

export default function StandardRateEditor({
  currentRate, currentEffectiveFrom, currentReason, currentSource,
  history, recentDerivedAvg,
}: {
  currentRate: number;
  currentEffectiveFrom: string | null;
  currentReason: string;
  currentSource: "manual" | "derived";
  history: StandardRateHistoryRow[];
  recentDerivedAvg: number | null;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [rate, setRate]     = useState<string>(String(currentRate || ""));
  const [reason, setReason] = useState<string>(currentReason);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const dirty = Number(rate) !== Number(currentRate) || (reason ?? "") !== (currentReason ?? "");

  async function save(source: "manual" | "derived" = "manual") {
    if (rate === "" || isNaN(Number(rate)) || Number(rate) < 0) {
      setError("Enter a valid rate (>= 0)."); return;
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
      rate_per_kg:    Number(rate),
      previous_rate:  currentRate || null,    // snapshot whatever was effective just before
      override_reason: reason.trim() || null,
      source,
      created_by:     user.id,
    };

    const { error: err } = await supabase
      .from("overhead_standard_rate")
      .upsert(payload, { onConflict: "tenant_id,effective_from" });

    setSaving(false);
    if (err) { setError(err.message); return; }
    router.refresh();
  }

  function useDerivedSuggestion() {
    if (recentDerivedAvg == null) return;
    setRate(recentDerivedAvg.toFixed(4));
    setReason(prev => prev || `Auto from 4-week average ($${recentDerivedAvg.toFixed(4)}/kg)`);
  }

  return (
    <div className="card" style={{ padding: "1.25rem", marginBottom: "1rem" }}>
      <h2 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 700 }}>
        Standard overhead rate
        {currentSource === "derived" && (
          <span style={{ marginLeft: "0.5rem", fontSize: "0.7rem", fontWeight: 600, color: "#166534", background: "#dcfce7", padding: "0.1rem 0.4rem", borderRadius: "999px" }}>auto-derived</span>
        )}
        {currentSource === "manual" && currentReason && (
          <span style={{ marginLeft: "0.5rem", fontSize: "0.7rem", fontWeight: 600, color: "#854d0e", background: "#fef3c7", padding: "0.1rem 0.4rem", borderRadius: "999px" }}>override</span>
        )}
      </h2>

      {error && (
        <div style={{ padding: "0.5rem 0.75rem", marginBottom: "0.625rem", background: "#fee2e2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: "0.375rem", fontSize: "0.8125rem" }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.7rem", color: "#78716c", marginBottom: "0.25rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            $/kg
          </label>
          <div style={{ position: "relative", display: "inline-block" }}>
            <span style={{ position: "absolute", left: "0.6rem", top: "50%", transform: "translateY(-50%)", color: "#78716c", fontFamily: "monospace", fontSize: "1rem" }}>$</span>
            <input
              type="text" inputMode="decimal"
              className="form-input"
              value={rate}
              onChange={e => setRate(e.target.value)}
              placeholder="0.45"
              style={{ width: 180, paddingLeft: "1.4rem", fontFamily: "monospace", fontSize: "1.1rem", textAlign: "right" }}
            />
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 240 }}>
          <label style={{ display: "block", fontSize: "0.7rem", color: "#78716c", marginBottom: "0.25rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Reason for change (for audit)
          </label>
          <input
            className="form-input"
            placeholder="e.g. set higher to absorb 2026 utility increase"
            value={reason}
            onChange={e => setReason(e.target.value)}
            style={{ width: "100%", fontSize: "0.8125rem" }}
          />
        </div>

        <button
          type="button"
          onClick={() => save("manual")}
          disabled={!dirty || saving}
          className="btn-primary"
          style={{ opacity: dirty ? 1 : 0.5, cursor: dirty ? "pointer" : "default" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* "Use 4-week derived average" shortcut */}
      {recentDerivedAvg != null && (
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.75rem", color: "#78716c" }}>
            4-week average from actuals: <strong style={{ fontFamily: "monospace", color: "#1c1917" }}>{fmtMoney(recentDerivedAvg)}/kg</strong>
          </span>
          <button
            type="button"
            onClick={useDerivedSuggestion}
            style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem", background: "#fafaf9", border: "1px solid #cfc9bf", borderRadius: "0.3rem", cursor: "pointer", color: "#57534e" }}
            title="Copy this value into the input above"
          >
            Use this value
          </button>
        </div>
      )}

      {currentEffectiveFrom && currentRate > 0 && (
        <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "#78716c" }}>
          Currently effective from <strong style={{ color: "#1c1917", fontFamily: "monospace" }}>{currentEffectiveFrom}</strong>
          {currentReason && <> — <em>{currentReason}</em></>}
        </div>
      )}

      {/* History */}
      <div style={{ marginTop: "0.75rem" }}>
        <button
          type="button"
          onClick={() => setHistoryOpen(o => !o)}
          style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer", fontSize: "0.8125rem", fontWeight: 600, color: "#1c1917", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
        >
          {historyOpen ? "▾" : "▸"} History
          <span style={{ color: "#78716c", fontWeight: 400, fontSize: "0.75rem" }}>
            ({history.length} {history.length === 1 ? "entry" : "entries"})
          </span>
        </button>

        {historyOpen && history.length > 0 && (
          <table style={{ width: "100%", marginTop: "0.5rem", fontSize: "0.8125rem" }}>
            <thead>
              <tr style={{ color: "#78716c", textAlign: "left" }}>
                <th style={{ padding: "0.3rem 0.4rem", width: "15%" }}>Effective</th>
                <th style={{ padding: "0.3rem 0.4rem", width: "15%", textAlign: "right" }}>$/kg</th>
                <th style={{ padding: "0.3rem 0.4rem", width: "15%", textAlign: "right" }}>Previous</th>
                <th style={{ padding: "0.3rem 0.4rem", width: "12%" }}>Source</th>
                <th style={{ padding: "0.3rem 0.4rem" }}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={h.id} style={i === 0 ? { background: "#fefce8" } : undefined}>
                  <td style={{ padding: "0.3rem 0.4rem", fontFamily: "monospace" }}>{h.effective_from}</td>
                  <td style={{ padding: "0.3rem 0.4rem", textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{fmtMoney(h.rate_per_kg)}</td>
                  <td style={{ padding: "0.3rem 0.4rem", textAlign: "right", fontFamily: "monospace", color: "#78716c" }}>
                    {h.previous_rate != null ? fmtMoney(h.previous_rate) : <span style={{ color: "#a8a29e" }}>—</span>}
                  </td>
                  <td style={{ padding: "0.3rem 0.4rem", color: h.source === "derived" ? "#166534" : "#854d0e", fontWeight: 500 }}>
                    {h.source}
                  </td>
                  <td style={{ padding: "0.3rem 0.4rem", color: "#57534e" }}>
                    {h.override_reason || <span style={{ color: "#a8a29e" }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
