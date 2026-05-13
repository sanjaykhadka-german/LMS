"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Category = { id: string; name: string; description: string | null };

export default function UserCategoriesManager({ initialCategories }: { initialCategories: Category[] }) {
  const supabase = createClient();
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [editing, setEditing] = useState<Category | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openNew() {
    setEditing(null); setIsNew(true); setName(""); setDescription(""); setError(null);
  }

  function openEdit(c: Category) {
    setEditing(c); setIsNew(false); setName(c.name); setDescription(c.description ?? ""); setError(null);
  }

  function cancel() {
    setEditing(null); setIsNew(false); setError(null);
  }

  async function save() {
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true); setError(null);

    if (isNew) {
      const { data, error: err } = await supabase
        .from("user_categories")
        .insert({ name: name.trim(), description: description.trim() || null })
        .select().single();
      if (err) { setError(err.message); setSaving(false); return; }
      setCategories(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    } else if (editing) {
      const { data, error: err } = await supabase
        .from("user_categories")
        .update({ name: name.trim(), description: description.trim() || null })
        .eq("id", editing.id).select().single();
      if (err) { setError(err.message); setSaving(false); return; }
      setCategories(prev => prev.map(c => c.id === data.id ? data : c).sort((a, b) => a.name.localeCompare(b.name)));
    }

    setSaving(false); cancel();
  }

  async function remove(id: string) {
    if (!confirm("Delete this category? Users assigned to it will lose their category.")) return;
    setDeleting(id);
    const { error: err } = await supabase.from("user_categories").delete().eq("id", id);
    if (err) { setError(err.message); setDeleting(null); return; }
    setCategories(prev => prev.filter(c => c.id !== id));
    setDeleting(null);
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#1c1917" }}>{categories.length} categories</span>
        <button className="btn-primary" style={{ fontSize: "0.8125rem" }} onClick={openNew}>+ Add Category</button>
      </div>

      {/* Inline form */}
      {(isNew || editing) && (
        <div style={{ padding: "1.25rem", borderBottom: "1px solid #e7e5e4", background: "#fafaf9" }}>
          <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, margin: "0 0 1rem" }}>
            {isNew ? "New Category" : `Edit — ${editing?.name}`}
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div>
              <label className="form-label">Name *</label>
              <input className="form-input" value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Contractor, Labour Hire, Apprentice" style={{ maxWidth: "360px" }} />
            </div>
            <div>
              <label className="form-label">Description <span style={{ color: "#a8a29e", fontWeight: 400 }}>(optional)</span></label>
              <input className="form-input" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Brief description of who falls in this category" />
            </div>
            {error && <p style={{ color: "#dc2626", fontSize: "0.875rem", margin: 0 }}>{error}</p>}
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : isNew ? "Add" : "Save"}</button>
              <button className="btn-secondary" onClick={cancel}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {categories.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#78716c", fontSize: "0.9rem" }}>
          No categories yet. Add one above.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Name</th><th>Description</th><th></th></tr>
          </thead>
          <tbody>
            {categories.map(c => (
              <tr key={c.id}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td style={{ color: "#78716c" }}>{c.description ?? <span style={{ color: "#d6d3d1" }}>—</span>}</td>
                <td>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }} onClick={() => openEdit(c)}>Edit</button>
                    <button
                      style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem", background: "none", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#dc2626", cursor: "pointer" }}
                      onClick={() => remove(c.id)} disabled={deleting === c.id}>
                      {deleting === c.id ? "…" : "Delete"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
