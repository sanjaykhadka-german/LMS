"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BackButton } from "@/components/back-button";
import {
  createDepartmentAction,
  deleteDepartmentAction,
  toggleDepartmentActiveAction,
  updateDepartmentAction,
} from "../actions";

type Department = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

const BLANK = { name: "", code: "", description: "", sort_order: 0 };

export default function DepartmentsManager({ initialDepartments }: { initialDepartments: Department[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Department | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function set(k: string, v: string | number) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.name.trim()) { setError("Name is required"); return; }
    setSaving(true); setError(null);

    try {
      if (editing) {
        await updateDepartmentAction(editing.id, form);
      } else {
        await createDepartmentAction(form);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
      return;
    }

    setSaving(false);
    setEditing(null);
    setAdding(false);
    setForm(BLANK);
    startTransition(() => router.refresh());
  }

  async function toggleActive(dept: Department) {
    try {
      await toggleDepartmentActiveAction(dept.id, !dept.is_active);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Toggle failed");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function deleteDept(dept: Department) {
    if (!confirm(`Delete department "${dept.name}"? This cannot be undone.`)) return;
    try {
      await deleteDepartmentAction(dept.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
      return;
    }
    startTransition(() => router.refresh());
  }

  function startEdit(dept: Department) {
    setEditing(dept);
    setForm({ name: dept.name, code: dept.code ?? "", description: dept.description ?? "", sort_order: dept.sort_order });
    setAdding(false);
  }

  function cancel() { setEditing(null); setAdding(false); setForm(BLANK); setError(null); }

  const showForm = editing || adding;

  return (
    <div style={{ maxWidth: "800px" }}>
      <BackButton href="/settings" label="Settings" />
      <div className="page-header">
        <div>
          <h1 className="page-title">Departments</h1>
          <p className="page-subtitle">Production and operational departments used across the app</p>
        </div>
        {!showForm && (
          <button onClick={() => { setAdding(true); setEditing(null); setForm(BLANK); }} className="btn-primary">
            + New Department
          </button>
        )}
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>
            {editing ? "Edit Department" : "New Department"}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Name *</label>
              <input className="form-input" value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Boning Room" />
            </div>
            <div>
              <label className="form-label">Code</label>
              <input className="form-input" value={form.code} onChange={e => set("code", e.target.value.toUpperCase())}
                placeholder="e.g. BONE" style={{ fontFamily: "monospace", textTransform: "uppercase" }} />
            </div>
            <div>
              <label className="form-label">Sort Order</label>
              <input className="form-input" type="number" min="0" value={form.sort_order}
                onChange={e => set("sort_order", parseInt(e.target.value) || 0)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Description</label>
              <input className="form-input" value={form.description} onChange={e => set("description", e.target.value)}
                placeholder="Optional description" />
            </div>
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: "0.875rem", margin: "0.75rem 0 0" }}>{error}</p>}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button onClick={save} className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Create Department"}
            </button>
            <button onClick={cancel} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Description</th>
              <th>Order</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {initialDepartments.length === 0 && (
              <tr><td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
                No departments yet. Add your first department above.
              </td></tr>
            )}
            {initialDepartments.map(d => (
              <tr key={d.id} style={{ opacity: d.is_active ? 1 : 0.55 }}>
                <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{d.code ?? "—"}</td>
                <td style={{ fontWeight: 500 }}>{d.name}</td>
                <td style={{ color: "#78716c", fontSize: "0.8125rem" }}>{d.description ?? "—"}</td>
                <td style={{ color: "#78716c" }}>{d.sort_order}</td>
                <td>
                  {d.is_active
                    ? <span className="badge badge-green" style={{ fontSize: "0.6875rem" }}>Active</span>
                    : <span className="badge badge-gray" style={{ fontSize: "0.6875rem" }}>Inactive</span>}
                </td>
                <td>
                  <div style={{ display: "flex", gap: "0.375rem" }}>
                    <button onClick={() => startEdit(d)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}>Edit</button>
                    <button onClick={() => toggleActive(d)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}>
                      {d.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button onClick={() => deleteDept(d)} style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem",
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
