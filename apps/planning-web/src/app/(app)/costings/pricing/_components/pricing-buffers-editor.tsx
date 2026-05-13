"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type BufferState = {
  production_loss_pct: number;
  cooking_loss_pct: number;
  packing_loss_pct: number;
  open_pack_pct: number;
  giveaway_pct: number;
  depreciation_pct: number;
  sample_pct: number;
  product_dev_pct: number;
  error_pct: number;
  target_margin_pct: number;
  notes: string;
  effective_from: string | null;
};

export type BufferHistoryRow = {
  id: string;
  effective_from: string;
  production_loss_pct: number;
  cooking_loss_pct: number;
  packing_loss_pct: number;
  open_pack_pct: number;
  giveaway_pct: number;
  depreciation_pct: number;
  sample_pct: number;
  product_dev_pct: number;
  error_pct: number;
  target_margin_pct: number;
  notes: string;
};

const BUFFER_FIELDS: Array<{ key: keyof BufferState; label: string; hint: string }> = [
  { key: "production_loss_pct", label: "Production loss",    hint: "Machine waste, drops, spillage (tenant default — items can override)" },
  { key: "cooking_loss_pct",    label: "Cooking buffer",      hint: "Pad on TOP of BOM yield_factor (items can override)" },
  { key: "packing_loss_pct",    label: "Packing loss",        hint: "Breakage / damage at packing (items can override)" },
  { key: "open_pack_pct",       label: "Open packs",          hint: "Samples / opened-and-rejected packs (items can override)" },
  { key: "giveaway_pct",        label: "Giveaway",            hint: "Overfill above label weight on fixed-weight FGs (items can override)" },
  { key: "depreciation_pct",    label: "Depreciation",        hint: "Equipment depreciation not absorbed in dept OH" },
  { key: "sample_pct",          label: "Samples / QA holds",  hint: "Free samples, micro holds, customer trials" },
  { key: "product_dev_pct",     label: "Product development", hint: "R&D loading, recipe iteration" },
  { key: "error_pct",           label: "Error margin",        hint: "Operational buffer (weighing, recipe drift)" },
];

function pctStr(v: number): string { return String(v); }

export default function PricingBuffersEditor({
  current, history,
}: {
  current: BufferState | null;
  history: BufferHistoryRow[];
}) {
  const supabase = createClient();
  const router = useRouter();

  const seed: BufferState = current ?? {
    production_loss_pct: 0,
    cooking_loss_pct: 0,
    packing_loss_pct: 0,
    open_pack_pct: 0,
    giveaway_pct: 0,
    depreciation_pct: 0,
    sample_pct: 0,
    product_dev_pct: 0,
    error_pct: 0,
    target_margin_pct: 0,
    notes: "",
    effective_from: null,
  };

  const [state, setState] = useState<Record<string, string>>({
    production_loss_pct: pctStr(seed.production_loss_pct),
    cooking_loss_pct:    pctStr(seed.cooking_loss_pct),
    packing_loss_pct:    pctStr(seed.packing_loss_pct),
    open_pack_pct:       pctStr(seed.open_pack_pct),
    giveaway_pct:        pctStr(seed.giveaway_pct),
    depreciation_pct:    pctStr(seed.depreciation_pct),
    sample_pct:          pctStr(seed.sample_pct),
    product_dev_pct:     pctStr(seed.product_dev_pct),
    error_pct:           pctStr(seed.error_pct),
    target_margin_pct:   pctStr(seed.target_margin_pct),
    notes:               seed.notes,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  function set(k: string, v: string) { setState(prev => ({ ...prev, [k]: v })); }

  const dirty = (() => {
    if (!current) {
      // Treat all-zero state as not-dirty even when no current row exists
      return Object.values(state).some(v => v !== "" && v !== "0" && v !== "0%");
    }
    return (
      Number(state.production_loss_pct) !== current.production_loss_pct ||
      Number(state.cooking_loss_pct)    !== current.cooking_loss_pct    ||
      Number(state.packing_loss_pct)    !== current.packing_loss_pct    ||
      Number(state.open_pack_pct)       !== current.open_pack_pct       ||
      Number(state.giveaway_pct)        !== current.giveaway_pct        ||
      Number(state.depreciation_pct)    !== current.depreciation_pct    ||
      Number(state.sample_pct)          !== current.sample_pct          ||
      Number(state.product_dev_pct)     !== current.product_dev_pct     ||
      Number(state.error_pct)           !== current.error_pct           ||
      Number(state.target_margin_pct)   !== current.target_margin_pct   ||
      (state.notes ?? "") !== (current.notes ?? "")
    );
  })();

  // Live preview using a sample COGS of $10 — pure illustration so the
  // operator can see how the buffers feel before saving.
  const SAMPLE_COGS = 10;
  const buffersSum =
    (Number(state.production_loss_pct) || 0) +
    (Number(state.cooking_loss_pct)    || 0) +
    (Number(state.packing_loss_pct)    || 0) +
    (Number(state.open_pack_pct)       || 0) +
    (Number(state.giveaway_pct)        || 0) +
    (Number(state.depreciation_pct)    || 0) +
    (Number(state.sample_pct)          || 0) +
    (Number(state.product_dev_pct)     || 0) +
    (Number(state.error_pct)           || 0);
  const loadedCost  = SAMPLE_COGS * (1 + buffersSum / 100);
  const marginPct   = Number(state.target_margin_pct) || 0;
  const minSellPrice = marginPct >= 100
    ? null
    : loadedCost / (1 - marginPct / 100);

  async function save() {
    setError(null);
    for (const f of BUFFER_FIELDS) {
      const v = Number(state[f.key as string]);
      if (isNaN(v) || v < 0 || v >= 100) { setError(`${f.label}: enter 0–99.99`); return; }
    }
    const mv = Number(state.target_margin_pct);
    if (isNaN(mv) || mv < 0 || mv >= 100) { setError("Target margin: enter 0–99.99"); return; }

    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not signed in"); setSaving(false); return; }
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user.id).single();
    if (!profile?.tenant_id) { setError("No tenant on profile"); setSaving(false); return; }

    const today = new Date().toISOString().slice(0, 10);
    const payload = {
      tenant_id:           profile.tenant_id,
      effective_from:      today,
      production_loss_pct: Number(state.production_loss_pct) || 0,
      cooking_loss_pct:    Number(state.cooking_loss_pct)    || 0,
      packing_loss_pct:    Number(state.packing_loss_pct)    || 0,
      open_pack_pct:       Number(state.open_pack_pct)       || 0,
      giveaway_pct:        Number(state.giveaway_pct)        || 0,
      depreciation_pct:    Number(state.depreciation_pct)    || 0,
      sample_pct:          Number(state.sample_pct)          || 0,
      product_dev_pct:     Number(state.product_dev_pct)     || 0,
      error_pct:           Number(state.error_pct)           || 0,
      target_margin_pct:   Number(state.target_margin_pct)   || 0,
      notes:               (state.notes ?? "").trim() || null,
      created_by:          user.id,
    };

    const { error: err } = await supabase
      .from("pricing_buffers")
      .upsert(payload, { onConflict: "tenant_id,effective_from" });

    setSaving(false);
    if (err) { setError(err.message); return; }
    router.refresh();
  }

  return (
    <div>
      {error && (
        <div style={{ padding: "0.5rem 0.75rem", marginBottom: "0.625rem", background: "#fee2e2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: "0.375rem", fontSize: "0.8125rem" }}>{error}</div>
      )}

      {/* Two-column editor: percentages on the left, live preview on the right */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
        <div className="card" style={{ padding: "1.25rem" }}>
          <h2 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 700 }}>Cost buffers</h2>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.75rem", color: "#78716c" }}>
            Each adds <em>X%</em> on top of COGS. They sum into the loaded cost — the basis target margin is applied to.
          </p>

          {BUFFER_FIELDS.map(f => (
            <div key={f.key as string} style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "0.5rem" }}>
              <label style={{ flex: 1, fontSize: "0.8125rem", color: "#1c1917" }}>
                <div style={{ fontWeight: 600 }}>{f.label}</div>
                <div style={{ fontSize: "0.7rem", color: "#78716c" }}>{f.hint}</div>
              </label>
              <div style={{ position: "relative", width: 95 }}>
                <input
                  type="text" inputMode="decimal" pattern="[0-9.]*"
                  className="form-input"
                  value={state[f.key as string]}
                  onChange={e => set(f.key as string, e.target.value)}
                  style={{ width: "100%", fontFamily: "monospace", textAlign: "right", paddingRight: "1.6rem", fontSize: "0.9rem" }}
                />
                <span style={{ position: "absolute", right: "0.55rem", top: "50%", transform: "translateY(-50%)", color: "#78716c", fontFamily: "monospace", fontSize: "0.85rem" }}>%</span>
              </div>
            </div>
          ))}

          <hr style={{ border: 0, borderTop: "1px solid #e7e5e4", margin: "0.75rem 0" }} />

          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "0.5rem" }}>
            <label style={{ flex: 1, fontSize: "0.8125rem", color: "#1c1917" }}>
              <div style={{ fontWeight: 600 }}>Target gross margin</div>
              <div style={{ fontSize: "0.7rem", color: "#78716c" }}>price = loaded_cost / (1 − margin%) — revenue-based margin</div>
            </label>
            <div style={{ position: "relative", width: 95 }}>
              <input
                type="text" inputMode="decimal" pattern="[0-9.]*"
                className="form-input"
                value={state.target_margin_pct}
                onChange={e => set("target_margin_pct", e.target.value)}
                style={{ width: "100%", fontFamily: "monospace", textAlign: "right", paddingRight: "1.6rem", fontSize: "0.9rem", color: "#166534", fontWeight: 600 }}
              />
              <span style={{ position: "absolute", right: "0.55rem", top: "50%", transform: "translateY(-50%)", color: "#78716c", fontFamily: "monospace", fontSize: "0.85rem" }}>%</span>
            </div>
          </div>

          <label style={{ display: "block", fontSize: "0.7rem", color: "#78716c", marginTop: "0.5rem", marginBottom: "0.25rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Reason for change (audit)
          </label>
          <input
            className="form-input"
            placeholder="e.g. 2026 review, post utility increase"
            value={state.notes}
            onChange={e => set("notes", e.target.value)}
            style={{ width: "100%", fontSize: "0.8125rem" }}
          />

          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="btn-primary"
            style={{ marginTop: "0.75rem", opacity: dirty ? 1 : 0.5, cursor: dirty ? "pointer" : "default" }}
          >
            {saving ? "Saving…" : "Save"}
          </button>

          {current?.effective_from && (
            <div style={{ marginTop: "0.625rem", fontSize: "0.7rem", color: "#78716c" }}>
              Currently effective from <strong style={{ fontFamily: "monospace", color: "#1c1917" }}>{current.effective_from}</strong>
              {current.notes && <> — <em>{current.notes}</em></>}
            </div>
          )}
        </div>

        {/* Live preview */}
        <div className="card" style={{ padding: "1.25rem", background: "#fafaf9" }}>
          <h2 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 700 }}>Live preview</h2>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.75rem", color: "#78716c" }}>
            Worked example with a sample COGS of <strong style={{ fontFamily: "monospace" }}>$10.00</strong> to give you a feel for the buildup.
          </p>
          <Row label="COGS"                value={SAMPLE_COGS} />
          <Row label="+ Production loss"    value={SAMPLE_COGS * Number(state.production_loss_pct || 0) / 100} subtle />
          <Row label="+ Cooking buffer"     value={SAMPLE_COGS * Number(state.cooking_loss_pct    || 0) / 100} subtle />
          <Row label="+ Packing loss"       value={SAMPLE_COGS * Number(state.packing_loss_pct    || 0) / 100} subtle />
          <Row label="+ Open packs"         value={SAMPLE_COGS * Number(state.open_pack_pct       || 0) / 100} subtle />
          <Row label="+ Giveaway"           value={SAMPLE_COGS * Number(state.giveaway_pct        || 0) / 100} subtle />
          <Row label="+ Depreciation"       value={SAMPLE_COGS * Number(state.depreciation_pct    || 0) / 100} subtle />
          <Row label="+ Samples / QA"       value={SAMPLE_COGS * Number(state.sample_pct          || 0) / 100} subtle />
          <Row label="+ Product dev"        value={SAMPLE_COGS * Number(state.product_dev_pct     || 0) / 100} subtle />
          <Row label="+ Error margin"       value={SAMPLE_COGS * Number(state.error_pct           || 0) / 100} subtle />
          <hr style={{ border: 0, borderTop: "1px solid #cfc9bf", margin: "0.4rem 0" }} />
          <Row label="= Loaded cost"        value={loadedCost} bold />
          <Row label="+ Target margin uplift" value={(minSellPrice ?? loadedCost) - loadedCost} subtle />
          <hr style={{ border: 0, borderTop: "2px solid #1c1917", margin: "0.4rem 0" }} />
          <Row label="MINIMUM SELL PRICE"   value={minSellPrice} emphasis />
          {marginPct >= 100 && (
            <div style={{ marginTop: "0.4rem", fontSize: "0.7rem", color: "#b91c1c" }}>
              Margin must be &lt; 100% (else price → ∞).
            </div>
          )}
        </div>
      </div>

      {/* History */}
      <div className="card" style={{ padding: "0.75rem 1.25rem" }}>
        <button
          type="button"
          onClick={() => setHistoryOpen(o => !o)}
          style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, color: "#1c1917", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
        >
          {historyOpen ? "▾" : "▸"} History
          <span style={{ color: "#78716c", fontWeight: 400, fontSize: "0.75rem" }}>({history.length} {history.length === 1 ? "entry" : "entries"})</span>
        </button>
        {historyOpen && history.length > 0 && (
          <table style={{ width: "100%", marginTop: "0.5rem", fontSize: "0.75rem" }}>
            <thead>
              <tr style={{ color: "#78716c", textAlign: "left" }}>
                <th style={{ padding: "0.3rem 0.4rem" }}>Effective</th>
                <th style={{ padding: "0.3rem 0.4rem", textAlign: "right" }}>Loss</th>
                <th style={{ padding: "0.3rem 0.4rem", textAlign: "right" }}>Depr</th>
                <th style={{ padding: "0.3rem 0.4rem", textAlign: "right" }}>Sample</th>
                <th style={{ padding: "0.3rem 0.4rem", textAlign: "right" }}>R&amp;D</th>
                <th style={{ padding: "0.3rem 0.4rem", textAlign: "right" }}>Error</th>
                <th style={{ padding: "0.3rem 0.4rem", textAlign: "right" }}>Margin</th>
                <th style={{ padding: "0.3rem 0.4rem" }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={h.id} style={i === 0 ? { background: "#fefce8" } : undefined}>
                  <td style={{ padding: "0.3rem 0.4rem", fontFamily: "monospace" }}>{h.effective_from}</td>
                  <td style={{ padding: "0.3rem 0.4rem", textAlign: "right", fontFamily: "monospace" }}>{h.production_loss_pct}%</td>
                  <td style={{ padding: "0.3rem 0.4rem", textAlign: "right", fontFamily: "monospace" }}>{h.depreciation_pct}%</td>
                  <td style={{ padding: "0.3rem 0.4rem", textAlign: "right", fontFamily: "monospace" }}>{h.sample_pct}%</td>
                  <td style={{ padding: "0.3rem 0.4rem", textAlign: "right", fontFamily: "monospace" }}>{h.product_dev_pct}%</td>
                  <td style={{ padding: "0.3rem 0.4rem", textAlign: "right", fontFamily: "monospace" }}>{h.error_pct}%</td>
                  <td style={{ padding: "0.3rem 0.4rem", textAlign: "right", fontFamily: "monospace", color: "#166534", fontWeight: 600 }}>{h.target_margin_pct}%</td>
                  <td style={{ padding: "0.3rem 0.4rem", color: "#57534e" }}>{h.notes || <span style={{ color: "#a8a29e" }}>—</span>}</td>
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

function Row({ label, value, bold = false, subtle = false, emphasis = false }: {
  label: string; value: number | null; bold?: boolean; subtle?: boolean; emphasis?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
      <span style={{
        fontSize: subtle ? "0.75rem" : emphasis ? "0.95rem" : "0.85rem",
        color: subtle ? "#78716c" : "#1c1917",
        fontWeight: emphasis ? 700 : bold ? 700 : 400,
        textTransform: emphasis ? "uppercase" : "none",
        letterSpacing: emphasis ? "0.04em" : 0,
      }}>{label}</span>
      <span style={{
        fontFamily: "monospace",
        fontWeight: emphasis ? 700 : bold ? 700 : 500,
        fontSize: emphasis ? "1.1rem" : bold ? "0.95rem" : "0.85rem",
        color: emphasis ? "#166534" : subtle ? "#78716c" : "#1c1917",
      }}>
        {value == null ? "—" : "$" + value.toLocaleString("en-AU", { minimumFractionDigits: emphasis ? 2 : 4, maximumFractionDigits: emphasis ? 2 : 4 })}
      </span>
    </div>
  );
}
