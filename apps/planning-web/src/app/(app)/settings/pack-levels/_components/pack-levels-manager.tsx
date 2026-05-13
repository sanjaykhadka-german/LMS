"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";

type PackLevel = {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  short_label: string | null;
  sort_order: number;
  is_active: boolean;
  is_default: boolean;
};

const BLANK = {
  code: "",
  name: "",
  short_label: "",
  sort_order: 100,
  is_default: false,
};

export default function PackLevelsManager({
  initialLevels,
  usage,
}: {
  initialLevels: PackLevel[];
  /** Count of items currently referencing each level code in their pack_levels JSON. */
  usage: Record<string, number>;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [editing, setEditing] = useState<PackLevel | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof BLANK>(k: K, v: typeof BLANK[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function save() {
    if (!form.code.trim()) { setError("Code is required"); return; }
    if (!form.name.trim()) { setError("Display name is required"); return; }
    // Codes are used as JSON keys / dictionary lookups elsewhere — restrict
    // to lowercase letters/numbers/underscore so we don't get surprises.
    if (!/^[a-z0-9_]+$/.test(form.code.trim())) {
      setError("Code must be lowercase letters, digits, or underscores only (e.g. 'sub_outer').");
      return;
    }
    setSaving(true); setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from("profiles").select("tenant_id").eq("id", user!.id).single();

    const payload = {
      tenant_id: profile!.tenant_id,
      code: form.code.trim().toLowerCase(),
      name: form.name.trim(),
      short_label: form.short_label.trim() || null,
      sort_order: Number(form.sort_order) || 100,
      is_default: !!form.is_default,
    };

    if (editing) {
      // Block code-rename if the level is in use — it would orphan items
      // whose pack_levels[].code points at the old value. Operators should
      // rename the display name instead, or migrate items first.
      if (editing.code !== payload.code && (usage[editing.code] ?? 0) > 0) {
        setError(`Can't change the code: ${usage[editing.code]} item(s) reference "${editing.code}". Rename the display name instead.`);
        setSaving(false); return;
      }
      const { error: err } = await supabase
        .from("tenant_pack_level_defs").update(payload).eq("id", editing.id);
      if (err) { setError(err.message); setSaving(false); return; }
    } else {
      const { error: err } = await supabase
        .from("tenant_pack_level_defs").insert(payload);
      if (err) { setError(err.message); setSaving(false); return; }
    }

    // If is_default flipped to true, clear it on every other row so there's
    // exactly one default per tenant.
    if (payload.is_default) {
      await supabase
        .from("tenant_pack_level_defs")
        .update({ is_default: false })
        .eq("tenant_id", profile!.tenant_id)
        .neq("code", payload.code);
    }

    setSaving(false);
    setEditing(null); setAdding(false); setForm(BLANK);
    router.refresh();
  }

  async function toggleActive(l: PackLevel) {
    await supabase.from("tenant_pack_level_defs")
      .update({ is_active: !l.is_active }).eq("id", l.id);
    router.refresh();
  }

  async function remove(l: PackLevel) {
    const inUse = usage[l.code] ?? 0;
    if (inUse > 0) {
      alert(`Can't delete "${l.code}" — ${inUse} item(s) reference it in their pack hierarchy. Reassign those items first, or just deactivate this level instead.`);
      return;
    }
    if (!confirm(`Delete pack level "${l.code} (${l.name})"? This cannot be undone.`)) return;
    const { error: err } = await supabase
      .from("tenant_pack_level_defs").delete().eq("id", l.id);
    if (err) { alert(err.message); return; }
    router.refresh();
  }

  function startEdit(l: PackLevel) {
    setEditing(l);
    setForm({
      code: l.code, name: l.name, short_label: l.short_label ?? "",
      sort_order: l.sort_order, is_default: l.is_default,
    });
    setAdding(false);
    setError(null);
  }

  function cancel() {
    setEditing(null); setAdding(false);
    setForm(BLANK); setError(null);
  }

  const showForm = !!editing || adding;
  const totalInUse = initialLevels.filter(l => (usage[l.code] ?? 0) > 0).length;

  return (
    <div style={{ maxWidth: "1100px" }}>
      <BackButton href="/settings" label="Settings" />
      <div className="page-header">
        <div>
          <h1 className="page-title">Pack Hierarchy Levels</h1>
          <p className="page-subtitle">
            The named levels in your pack hierarchy (bottom-up, closest to piece first).
            {" "}{initialLevels.length} defined · {totalInUse} currently in use across items.
            Items reference these codes in their <code style={{ fontFamily: "monospace", background: "#f5f5f4", padding: "0.05rem 0.3rem", borderRadius: "0.25rem" }}>pack_levels</code> JSON;
            renaming the display name updates everywhere, but the code is the join key — change with care.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => { setAdding(true); setEditing(null); setForm(BLANK); setError(null); }}
            className="btn-primary"
          >
            + New Level
          </button>
        )}
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 1rem" }}>
            {editing ? `Edit Level — ${editing.code}` : "New Level"}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr 1fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Code *</label>
              <input
                className="form-input"
                value={form.code}
                onChange={e => set("code", e.target.value.toLowerCase())}
                placeholder="inner / sub_outer / outer / pallet"
                style={{ fontFamily: "monospace" }}
              />
              {editing && (usage[editing.code] ?? 0) > 0 && (
                <p style={{ fontSize: "0.7rem", color: "#92400e", margin: "0.3rem 0 0" }}>
                  ⚠ Used by {usage[editing.code]} item(s) — code can&apos;t be changed.
                </p>
              )}
            </div>
            <div>
              <label className="form-label">Display Name *</label>
              <input
                className="form-input"
                value={form.name}
                onChange={e => set("name", e.target.value)}
                placeholder="Inner / Sub-outer / Outer / Pallet"
              />
            </div>
            <div>
              <label className="form-label">Short Label</label>
              <input
                className="form-input"
                value={form.short_label}
                onChange={e => set("short_label", e.target.value)}
                placeholder="I / M / O / P"
                maxLength={3}
                style={{ fontFamily: "monospace", textAlign: "center" }}
              />
              <p style={{ fontSize: "0.7rem", color: "#a8a29e", margin: "0.25rem 0 0" }}>1–3 chars for compact UI</p>
            </div>
            <div>
              <label className="form-label">Sort Order</label>
              <input
                className="form-input"
                type="number" min="0"
                value={form.sort_order}
                onChange={e => set("sort_order", parseInt(e.target.value) || 100)}
              />
              <p style={{ fontSize: "0.7rem", color: "#a8a29e", margin: "0.25rem 0 0" }}>Ascending = bottom-up</p>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={e => set("is_default", e.target.checked)}
              />
              <span style={{ fontSize: "0.875rem" }}>Default level (seeded onto new items)</span>
            </label>
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: "0.875rem", margin: "0.75rem 0 0" }}>{error}</p>}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button onClick={save} className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Create Level"}
            </button>
            <button onClick={cancel} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: "60px", textAlign: "right" }}>#</th>
              <th style={{ width: "140px" }}>Code</th>
              <th>Display Name</th>
              <th style={{ width: "100px", textAlign: "center" }}>Short</th>
              <th style={{ width: "100px", textAlign: "center" }}>Default</th>
              <th style={{ width: "100px", textAlign: "right" }}>In use</th>
              <th style={{ width: "90px" }}>Status</th>
              <th style={{ width: "210px" }}></th>
            </tr>
          </thead>
          <tbody>
            {initialLevels.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: "1.5rem", textAlign: "center", color: "#78716c" }}>
                  No pack levels defined yet. Click <strong>+ New Level</strong> to add your first one.
                </td>
              </tr>
            )}
            {initialLevels.map(l => {
              const inUse = usage[l.code] ?? 0;
              return (
                <tr key={l.id} style={{ opacity: l.is_active ? 1 : 0.5 }}>
                  <td style={{ textAlign: "right", color: "#78716c", fontFamily: "monospace" }}>{l.sort_order}</td>
                  <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{l.code}</td>
                  <td>{l.name}</td>
                  <td style={{ textAlign: "center", fontFamily: "monospace", color: "#78716c" }}>
                    {l.short_label ?? "—"}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {l.is_default ? <span className="badge badge-blue" style={{ fontSize: "0.65rem" }}>Default</span> : "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {inUse > 0
                      ? <span style={{ fontWeight: 600, color: "#1e40af" }}>{inUse}</span>
                      : <span style={{ color: "#a8a29e" }}>0</span>}
                  </td>
                  <td>
                    <button
                      onClick={() => toggleActive(l)}
                      className={l.is_active ? "badge badge-green" : "badge badge-gray"}
                      style={{ border: "none", cursor: "pointer", fontSize: "0.7rem" }}
                      title="Click to toggle"
                    >
                      {l.is_active ? "● Active" : "○ Inactive"}
                    </button>
                  </td>
                  <td style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
                    <button
                      onClick={() => startEdit(l)}
                      className="btn-secondary"
                      style={{ fontSize: "0.75rem", padding: "0.3rem 0.7rem" }}
                    >Edit</button>
                    <button
                      onClick={() => remove(l)}
                      className="btn-secondary"
                      style={{
                        fontSize: "0.75rem", padding: "0.3rem 0.7rem",
                        background: "#fef2f2", color: "#991b1b", border: "1px solid #fca5a5",
                        opacity: inUse > 0 ? 0.5 : 1,
                        cursor: inUse > 0 ? "not-allowed" : "pointer",
                      }}
                      disabled={inUse > 0}
                      title={inUse > 0 ? "In use — deactivate instead, or migrate items first" : "Delete this level"}
                    >Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
