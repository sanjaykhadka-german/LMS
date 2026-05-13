"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";

type Classification = {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  default_australian: boolean;
  is_active: boolean;
};

const BLANK = { code: "", label: "", sort_order: 0, default_australian: false };

export default function ClassificationsManager({ initial }: { initial: Classification[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [editing, setEditing] = useState<Classification | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: keyof typeof BLANK, v: string | number | boolean) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function save() {
    if (!form.code.trim()) { setError("Code is required."); return; }
    if (!form.label.trim()) { setError("Label is required."); return; }
    setSaving(true); setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();

    const payload = {
      tenant_id: profile!.tenant_id,
      code: form.code.trim().toLowerCase().replace(/\s+/g, "_"),
      label: form.label.trim(),
      sort_order: Number(form.sort_order) || 0,
      default_australian: !!form.default_australian,
    };

    if (editing) {
      const { error: err } = await supabase.from("ingredient_classifications").update(payload).eq("id", editing.id);
      if (err) { setError(err.message); setSaving(false); return; }
    } else {
      const { error: err } = await supabase.from("ingredient_classifications").insert(payload);
      if (err) { setError(err.message); setSaving(false); return; }
    }

    setSaving(false);
    cancel();
    router.refresh();
  }

  async function toggleActive(row: Classification) {
    await supabase.from("ingredient_classifications").update({ is_active: !row.is_active }).eq("id", row.id);
    router.refresh();
  }

  async function remove(row: Classification) {
    if (!confirm(`Delete classification "${row.label}"? Components using this class will be set to no class.`)) return;
    const { error: err } = await supabase.from("ingredient_classifications").delete().eq("id", row.id);
    if (err) { alert(err.message); return; }
    router.refresh();
  }

  function startEdit(row: Classification) {
    setEditing(row);
    setForm({ code: row.code, label: row.label, sort_order: row.sort_order, default_australian: row.default_australian });
    setAdding(false);
    setError(null);
  }

  function cancel() {
    setEditing(null);
    setAdding(false);
    setForm(BLANK);
    setError(null);
  }

  const showForm = editing || adding;

  return (
    <div style={{ maxWidth: "900px" }}>
      <BackButton href="/settings" label="Settings" />
      <div className="page-header">
        <div>
          <h1 className="page-title">Ingredient Classifications</h1>
          <p className="page-subtitle">
            FSANZ-aligned classes used on the Item Master ingredient grid and grouped on spec sheets (e.g. &quot;Mineral Salt: 325, 262(i)&quot;).
          </p>
        </div>
        {!showForm && (
          <button onClick={() => { setAdding(true); setEditing(null); setForm(BLANK); }} className="btn-primary">
            + New Classification
          </button>
        )}
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 1rem" }}>
            {editing ? "Edit Classification" : "New Classification"}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "1rem", alignItems: "end" }}>
            <div>
              <label className="form-label">Label *</label>
              <input className="form-input" value={form.label} onChange={e => set("label", e.target.value)} placeholder="e.g. Mineral Salt" />
            </div>
            <div>
              <label className="form-label">Code *</label>
              <input className="form-input" value={form.code} onChange={e => set("code", e.target.value)}
                placeholder="e.g. mineral_salt" style={{ fontFamily: "monospace" }} />
            </div>
            <div>
              <label className="form-label">Sort Order</label>
              <input className="form-input" type="number" min="0" value={form.sort_order}
                onChange={e => set("sort_order", parseInt(e.target.value) || 0)} />
            </div>
            <div style={{ display: "flex", alignItems: "center", paddingBottom: "0.5rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
                <input type="checkbox" checked={form.default_australian} onChange={e => set("default_australian", e.target.checked)} />
                Default to Australia
              </label>
            </div>
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: "0.875rem", margin: "0.75rem 0 0" }}>{error}</p>}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button onClick={save} className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Create Classification"}
            </button>
            <button onClick={cancel} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: "60px" }}>Order</th>
              <th>Label</th>
              <th>Code</th>
              <th>Default Origin</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {initial.length === 0 && (
              <tr><td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
                No classifications yet. Add your first one above.
              </td></tr>
            )}
            {initial.map(c => (
              <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.55 }}>
                <td style={{ color: "#78716c" }}>{c.sort_order}</td>
                <td style={{ fontWeight: 500 }}>{c.label}</td>
                <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{c.code}</td>
                <td>
                  {c.default_australian
                    ? <span className="badge badge-green" style={{ fontSize: "0.6875rem" }}>Australia</span>
                    : <span style={{ color: "#a8a29e", fontSize: "0.8125rem" }}>—</span>}
                </td>
                <td>
                  {c.is_active
                    ? <span className="badge badge-green" style={{ fontSize: "0.6875rem" }}>Active</span>
                    : <span className="badge badge-gray" style={{ fontSize: "0.6875rem" }}>Inactive</span>}
                </td>
                <td>
                  <div style={{ display: "flex", gap: "0.375rem" }}>
                    <button onClick={() => startEdit(c)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}>Edit</button>
                    <button onClick={() => toggleActive(c)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}>
                      {c.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button onClick={() => remove(c)} style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem",
                      background: "none", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#dc2626", cursor: "pointer" }}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
