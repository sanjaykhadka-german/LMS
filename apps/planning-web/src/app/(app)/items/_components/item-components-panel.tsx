"use client";

/**
 * Item Master ingredient-components editor (Phase 3H.3).
 *
 * Lets the operator declare what an item is composed of when the
 * supplier-printed ingredient list expands beyond a single line — e.g.
 * Opti Form ACE S61 declares 4 sub-ingredients across 2 FSANZ classes.
 *
 * Each row maps to an item_ingredient_components row (mig 098):
 *   name              text         display name (must match label intent)
 *   classification_id uuid         FK → ingredient_classifications
 *   e_number          text         optional INS / E number
 *   percentage        numeric      sub-percentage of this component within
 *                                   the item (operator-entered, optional)
 *   meat_species      text         when class = Meat
 *   country_of_origin text         drives Phase 3H.5 CoO auto-calc
 *   is_processing_aid boolean      hidden by default on customer-facing
 *                                   spec output (FSANZ default)
 */

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

type Classification = {
  id: string;
  code: string;
  label: string;
  default_australian: boolean;
};

type Component = {
  id: string;
  tenant_id: string;
  item_id: string;
  sort_order: number;
  name: string;
  classification_id: string | null;
  e_number: string | null;
  percentage: number | null;
  meat_species: string | null;
  country_of_origin: string | null;
  is_processing_aid: boolean;
};

type Draft = {
  id?: string;
  sort_order: number;
  name: string;
  classification_id: string;
  e_number: string;
  percentage: string;
  meat_species: string;
  country_of_origin: string;
  is_processing_aid: boolean;
};

function emptyDraft(sort_order = 0): Draft {
  return { sort_order, name: "", classification_id: "", e_number: "", percentage: "", meat_species: "", country_of_origin: "", is_processing_aid: false };
}

export default function ItemComponentsPanel({ itemId, tenantId }: { itemId: string; tenantId: string }) {
  const supabase = createClient();
  const [classifications, setClassifications] = useState<Classification[]>([]);
  const [rows, setRows] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Inline "+ New class" modal state — Tino May 7 2026:
  // every dropdown that maps to a register should let an authorised user
  // create a new record without leaving the screen. This is the first
  // place we wire that pattern.
  const [newClassFor, setNewClassFor] = useState<number | null>(null);
  const [newClassLabel, setNewClassLabel] = useState("");
  const [newClassCode, setNewClassCode] = useState("");
  const [newClassSaving, setNewClassSaving] = useState(false);
  const [newClassErr, setNewClassErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: cls }, { data: comps }] = await Promise.all([
      supabase.from("ingredient_classifications").select("id, code, label, default_australian").eq("is_active", true).order("sort_order").order("label"),
      supabase.from("item_ingredient_components").select("*").eq("item_id", itemId).order("sort_order"),
    ]);
    setClassifications((cls ?? []) as Classification[]);
    setRows(((comps ?? []) as Component[]).map(c => ({
      id: c.id,
      sort_order: c.sort_order,
      name: c.name ?? "",
      classification_id: c.classification_id ?? "",
      e_number: c.e_number ?? "",
      percentage: c.percentage != null ? String(c.percentage) : "",
      meat_species: c.meat_species ?? "",
      country_of_origin: c.country_of_origin ?? "",
      is_processing_aid: !!c.is_processing_aid,
    })));
    setLoading(false);
  }, [itemId, supabase]);

  useEffect(() => { load(); }, [load]);

  function update(idx: number, patch: Partial<Draft>) {
    setRows(rs => rs.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }
  function addRow() {
    setRows(rs => [...rs, emptyDraft(rs.length)]);
  }
  function removeRow(idx: number) {
    setRows(rs => rs.filter((_, i) => i !== idx).map((r, i) => ({ ...r, sort_order: i })));
  }
  function moveUp(idx: number) {
    if (idx === 0) return;
    setRows(rs => {
      const next = [...rs];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next.map((r, i) => ({ ...r, sort_order: i }));
    });
  }
  function moveDown(idx: number) {
    if (idx >= rows.length - 1) return;
    setRows(rs => {
      const next = [...rs];
      [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
      return next.map((r, i) => ({ ...r, sort_order: i }));
    });
  }

  async function saveAll() {
    setSaving(true); setError(null);
    // Validate
    for (const r of rows) {
      if (!r.name.trim()) {
        setError("Every row needs a name.");
        setSaving(false);
        return;
      }
    }
    // Replace strategy: delete missing, upsert remaining. We track ids on
    // existing rows; rows without an id are inserts. Rows that were
    // deleted client-side are removed by diffing the ids on the server
    // round-trip.
    const { data: existing } = await supabase
      .from("item_ingredient_components")
      .select("id")
      .eq("item_id", itemId);
    const existingIds = new Set(((existing ?? []) as { id: string }[]).map(e => e.id));
    const keepIds = new Set(rows.map(r => r.id).filter(Boolean) as string[]);
    const toDelete = Array.from(existingIds).filter(id => !keepIds.has(id));
    if (toDelete.length > 0) {
      const { error: delErr } = await supabase.from("item_ingredient_components").delete().in("id", toDelete);
      if (delErr) { setError(delErr.message); setSaving(false); return; }
    }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const payload = {
        tenant_id: tenantId,
        item_id: itemId,
        sort_order: i,
        name: r.name.trim(),
        classification_id: r.classification_id || null,
        e_number: r.e_number.trim() || null,
        percentage: r.percentage.trim() === "" ? null : Number(r.percentage),
        meat_species: r.meat_species.trim() || null,
        country_of_origin: r.country_of_origin.trim() || null,
        is_processing_aid: r.is_processing_aid,
      };
      if (r.id) {
        const { error: upErr } = await supabase.from("item_ingredient_components").update(payload).eq("id", r.id);
        if (upErr) { setError(upErr.message); setSaving(false); return; }
      } else {
        const { error: insErr } = await supabase.from("item_ingredient_components").insert(payload);
        if (insErr) { setError(insErr.message); setSaving(false); return; }
      }
    }
    setSaving(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
    load();
  }

  async function createNewClass() {
    if (!newClassLabel.trim()) { setNewClassErr("Label is required."); return; }
    setNewClassSaving(true); setNewClassErr(null);
    const code = (newClassCode.trim() || newClassLabel.trim())
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    const nextSort = (classifications.length + 1) * 10;
    const { data, error: err } = await supabase
      .from("ingredient_classifications")
      .insert({ tenant_id: tenantId, code, label: newClassLabel.trim(), sort_order: nextSort, default_australian: false })
      .select("id, code, label, default_australian")
      .single();
    setNewClassSaving(false);
    if (err || !data) { setNewClassErr(err?.message ?? "Insert failed."); return; }
    // Refresh list and select the newly created class on the row that opened the modal.
    setClassifications(cs => [...cs, data as Classification]);
    if (newClassFor !== null) update(newClassFor, { classification_id: data.id });
    setNewClassFor(null);
  }

  if (loading) return <div className="card" style={{ padding: "1rem", color: "#78716c" }}>Loading components…</div>;

  const totalPct = rows.reduce((s, r) => s + (Number(r.percentage) || 0), 0);
  const isMeatClass = (id: string) => classifications.find(c => c.id === id)?.code === "meat";

  return (
    <div className="card" style={{ padding: "1rem 1rem 1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0, color: "#1c1917" }}>Ingredient Composition</h2>
          <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0.25rem 0 0" }}>
            Sub-ingredients of this item, grouped by FSANZ class on the spec sheet.
          </p>
        </div>
        <button onClick={addRow} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>+ Add row</button>
      </div>

      {rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "1.5rem 1rem", color: "#a8a29e", fontSize: "0.875rem", border: "1px dashed #e7e5e4", borderRadius: "0.375rem" }}>
          No composition rows yet. Add one if this item is a compound (e.g. cure mix, spice blend).
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e7e5e4", background: "#fafaf9" }}>
                <th style={{ ...thStyle, width: 30 }}>#</th>
                <th style={thStyle}>Name *</th>
                <th style={{ ...thStyle, width: 150 }}>Class</th>
                <th style={{ ...thStyle, width: 80 }}>E / INS</th>
                <th style={{ ...thStyle, width: 80 }}>%</th>
                <th style={{ ...thStyle, width: 110 }}>Meat species</th>
                <th style={{ ...thStyle, width: 130 }}>Country</th>
                <th style={{ ...thStyle, width: 60 }}>Aid</th>
                <th style={{ ...thStyle, width: 100 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.id ?? `new-${idx}`} style={{ borderBottom: "1px solid #f5f5f4" }}>
                  <td style={tdStyle}>{idx + 1}</td>
                  <td style={tdStyle}>
                    <input value={r.name} onChange={e => update(idx, { name: e.target.value })} className="form-input" style={{ width: "100%" }} placeholder="e.g. 325 Sodium Lactate" />
                  </td>
                  <td style={tdStyle}>
                    <select
                      value={r.classification_id}
                      onChange={e => {
                        if (e.target.value === "__new__") {
                          setNewClassFor(idx);
                          setNewClassLabel("");
                          setNewClassCode("");
                          setNewClassErr(null);
                        } else {
                          update(idx, { classification_id: e.target.value });
                        }
                      }}
                      className="form-input"
                      style={{ width: "100%" }}
                    >
                      <option value="">—</option>
                      {classifications.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      <option value="__new__">+ New class…</option>
                    </select>
                  </td>
                  <td style={tdStyle}>
                    <input value={r.e_number} onChange={e => update(idx, { e_number: e.target.value })} className="form-input" style={{ width: "100%" }} placeholder="325" />
                  </td>
                  <td style={tdStyle}>
                    <input type="number" step="0.01" value={r.percentage} onChange={e => update(idx, { percentage: e.target.value })} className="form-input" style={{ width: "100%" }} />
                  </td>
                  <td style={tdStyle}>
                    {isMeatClass(r.classification_id) ? (
                      <input value={r.meat_species} onChange={e => update(idx, { meat_species: e.target.value })} className="form-input" style={{ width: "100%" }} placeholder="Pork" />
                    ) : <span style={{ color: "#a8a29e" }}>—</span>}
                  </td>
                  <td style={tdStyle}>
                    <input value={r.country_of_origin} onChange={e => update(idx, { country_of_origin: e.target.value })} className="form-input" style={{ width: "100%" }} placeholder="Australia" />
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <input type="checkbox" checked={r.is_processing_aid} onChange={e => update(idx, { is_processing_aid: e.target.checked })} title="Processing aid (hidden on customer-facing spec by default)" />
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: "0.25rem" }}>
                      <button onClick={() => moveUp(idx)} disabled={idx === 0} title="Move up"
                        style={{ ...btnIconStyle, opacity: idx === 0 ? 0.3 : 1 }}>↑</button>
                      <button onClick={() => moveDown(idx)} disabled={idx >= rows.length - 1} title="Move down"
                        style={{ ...btnIconStyle, opacity: idx >= rows.length - 1 ? 0.3 : 1 }}>↓</button>
                      <button onClick={() => removeRow(idx)} title="Remove"
                        style={{ ...btnIconStyle, color: "#dc2626", borderColor: "#fca5a5" }}>×</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...tdStyle, fontWeight: 600 }} colSpan={4}>Total of declared %</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: Math.abs(totalPct - 100) > 0.5 && totalPct > 0 ? "#b45309" : "#1c1917" }}>
                  {totalPct ? totalPct.toFixed(2) + "%" : "—"}
                </td>
                <td colSpan={4} style={{ ...tdStyle, color: "#78716c", fontSize: "0.75rem" }}>
                  {totalPct > 0 && Math.abs(totalPct - 100) > 0.5 ? "Note: declared totals don't sum to 100%." : ""}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {error && <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#991b1b", fontSize: "0.8125rem" }}>{error}</div>}

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", alignItems: "center" }}>
        <button onClick={saveAll} disabled={saving} className="btn-primary" style={{ fontSize: "0.875rem" }}>
          {saving ? "Saving…" : "Save composition"}
        </button>
        <button onClick={load} disabled={saving} className="btn-secondary" style={{ fontSize: "0.875rem" }}>Reset</button>
        {savedFlash && <span style={{ color: "#166534", fontSize: "0.8125rem", fontWeight: 600 }}>✓ Saved.</span>}
      </div>

      {newClassFor !== null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => !newClassSaving && setNewClassFor(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "0.5rem", padding: "1.25rem", width: "min(380px, 92vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#1c1917" }}>New ingredient class</h2>
            <p style={{ margin: "0.25rem 0 0.875rem", fontSize: "0.8125rem", color: "#78716c" }}>
              Adds to the tenant register. You can edit the full row later in /settings/ingredient-classifications.
            </p>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#57534e", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Label *</label>
            <input value={newClassLabel} onChange={e => setNewClassLabel(e.target.value)} className="form-input" placeholder="e.g. Stabiliser" autoFocus />
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#57534e", margin: "0.5rem 0 0.25rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Code (optional)</label>
            <input value={newClassCode} onChange={e => setNewClassCode(e.target.value)} className="form-input" placeholder="auto-derived from label" style={{ fontFamily: "monospace" }} />
            {newClassErr && <div style={{ marginTop: "0.5rem", padding: "0.4rem 0.6rem", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#991b1b", fontSize: "0.8125rem" }}>{newClassErr}</div>}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button type="button" onClick={() => setNewClassFor(null)} disabled={newClassSaving} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Cancel</button>
              <button type="button" onClick={createNewClass} disabled={newClassSaving} className="btn-primary" style={{ fontSize: "0.8125rem" }}>
                {newClassSaving ? "Adding…" : "Add class"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "0.5rem 0.5rem", fontSize: "0.6875rem", fontWeight: 700, color: "#57534e",
  textTransform: "uppercase", letterSpacing: "0.05em",
};
const tdStyle: React.CSSProperties = { padding: "0.4rem 0.5rem", verticalAlign: "middle" };
const btnIconStyle: React.CSSProperties = {
  width: 26, height: 26, padding: 0, background: "#fff", border: "1px solid #d6d3d1", borderRadius: "0.25rem",
  cursor: "pointer", fontSize: "0.875rem", lineHeight: 1, color: "#44403c",
};
