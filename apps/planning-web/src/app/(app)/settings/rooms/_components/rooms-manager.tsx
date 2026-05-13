"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BarcodeChip } from "@/components/barcode-chip";

type Department = { id: string; name: string };

type Room = {
  id: string; name: string;
  code: string | null;
  description: string | null;
  sort_order: number | null;
  is_active: boolean;
  department_id: string | null;
  barcode: string | null;
  color: string | null;
  department?: { id: string; name: string } | null;
};

const COLORS = [
  "#ef4444","#b91c1c","#7f1d1d",
  "#f97316","#c2410c","#ea580c",
  "#f59e0b","#b45309","#ca8a04",
  "#22c55e","#15803d","#166534",
  "#14b8a6","#0d9488","#06b6d4",
  "#3b82f6","#0369a1","#1e40af",
  "#8b5cf6","#6d28d9","#a855f7",
  "#ec4899","#be185d","#f43f5e",
  "#6b7280","#374151","#1c1917",
];

const BLANK = {
  name: "",
  code: "",
  description: "",
  sort_order: "",
  is_active: true,
  department_id: "",
  barcode: "",
  color: COLORS[0],
};

export default function RoomsManager({
  initialRooms, departments,
}: {
  initialRooms: Room[];
  departments: Department[];
}) {
  const supabase = createClient();
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  const [form, setForm] = useState(BLANK);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const startEdit = (r: Room) => {
    setEditId(r.id);
    setForm({
      name: r.name,
      code: r.code ?? "",
      description: r.description ?? "",
      sort_order: String(r.sort_order ?? ""),
      is_active: r.is_active,
      department_id: r.department_id ?? "",
      barcode: r.barcode ?? "",
      color: r.color ?? COLORS[0],
    });
    setError(null);
  };

  const cancelEdit = () => { setEditId(null); setForm(BLANK); setError(null); };

  const getTenantId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: p } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();
    return p!.tenant_id as string;
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Name is required"); return; }
    if (!form.department_id) { setError("Department is required — every room must belong to a department"); return; }
    setSaving(true); setError(null);
    const payload = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      description: form.description.trim() || null,
      sort_order: form.sort_order !== "" ? Number(form.sort_order) : null,
      is_active: form.is_active,
      department_id: form.department_id || null,
      barcode: form.barcode.trim() || null,
      color: form.color || null,
    };

    if (editId) {
      const { error: e } = await supabase.from("rooms").update(payload).eq("id", editId);
      if (e) { setError(e.message); setSaving(false); return; }
      const dept = departments.find(d => d.id === payload.department_id) ?? null;
      setRooms(prev => prev.map(r => r.id === editId ? { ...r, ...payload, department: dept } : r));
      cancelEdit();
    } else {
      const tenantId = await getTenantId();
      const { data, error: e } = await supabase
        .from("rooms")
        .insert({ ...payload, tenant_id: tenantId })
        .select("id, name, code, description, sort_order, is_active, department_id, barcode, color, department:department_id(id, name)")
        .single();
      if (e || !data) { setError(e?.message ?? "Failed to create"); setSaving(false); return; }
      setRooms(prev => [...prev, data as unknown as Room]);
      setForm(BLANK);
    }
    setSaving(false);
  };

  const handleToggle = async (r: Room) => {
    const { error: e } = await supabase.from("rooms").update({ is_active: !r.is_active }).eq("id", r.id);
    if (!e) setRooms(prev => prev.map(x => x.id === r.id ? { ...x, is_active: !r.is_active } : x));
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "1.5rem", alignItems: "start" }}>
      {/* List */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4" }}>
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Rooms ({rooms.length})</h2>
        </div>
        {rooms.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>No rooms yet. Add one in the panel on the right.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Department</th>
                <th>Barcode</th>
                <th>Status</th>
                <th style={{ minWidth: "180px" }}></th>
              </tr>
            </thead>
            <tbody>
              {rooms.map(r => (
                <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.55 }}>
                  <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{r.code ?? "—"}</td>
                  <td style={{ fontWeight: 500 }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                      {r.color && <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: r.color, flexShrink: 0, display: "inline-block" }} />}
                      <span>{r.name}</span>
                    </div>
                  </td>
                  <td style={{ color: "#57534e" }}>{r.department?.name ?? "—"}</td>
                  <td style={{ fontSize: "0.8125rem", color: "#57534e" }}>
                    <BarcodeChip code={r.barcode} />
                  </td>
                  <td>
                    <span className={`badge ${r.is_active ? "badge-green" : "badge-gray"}`} style={{ fontSize: "0.6875rem" }}>
                      {r.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ display: "flex", gap: "0.375rem" }}>
                    {r.barcode && (
                      <Link
                        href={`/labels/print?code=${encodeURIComponent(r.barcode)}&name=${encodeURIComponent(r.name)}&sub=${encodeURIComponent(r.department?.name ?? "")}`}
                        target="_blank"
                        className="btn-secondary"
                        style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}
                      >
                        Label
                      </Link>
                    )}
                    <button onClick={() => startEdit(r)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}>Edit</button>
                    <button onClick={() => handleToggle(r)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}>
                      {r.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Form */}
      <div className="card">
        <h2 style={{ margin: "0 0 0.875rem", fontSize: "1rem", fontWeight: 600 }}>
          {editId ? "Edit Room" : "Add Room"}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          <div>
            <label className="form-label">Name *</label>
            <input className="form-input" value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Boning Room" />
          </div>
          <div>
            <label className="form-label">Code</label>
            <input className="form-input" value={form.code} onChange={e => set("code", e.target.value)} placeholder="optional short code" style={{ fontFamily: "monospace" }} />
          </div>
          <div>
            <label className="form-label">Department *</label>
            <select className="form-select" value={form.department_id} onChange={e => set("department_id", e.target.value)}>
              <option value="">— Pick a department —</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <p style={{ fontSize: "0.7rem", color: "#78716c", marginTop: "0.25rem" }}>
              Every room must belong to a department. Locations created inside this room inherit it.
            </p>
          </div>
          <div>
            <label className="form-label">Barcode</label>
            <input className="form-input" value={form.barcode} onChange={e => set("barcode", e.target.value)} placeholder="auto-generated on save (e.g. RM-AB12CD)" style={{ fontFamily: "monospace" }} />
            <p style={{ fontSize: "0.7rem", color: "#78716c", marginTop: "0.25rem" }}>
              Leave blank to auto-generate (RM-XXXXXX). Or paste an existing label code if you&apos;re mapping a room you&apos;ve already physically labelled. Clear and save to regenerate.
            </p>
          </div>
          <div>
            <label className="form-label">Colour</label>
            <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", marginTop: "0.25rem", alignItems: "center" }}>
              {COLORS.map(col => (
                <button key={col} type="button" onClick={() => set("color", col)} title={col} style={{
                  width: "22px", height: "22px", borderRadius: "50%", background: col, flexShrink: 0, cursor: "pointer",
                  border: form.color === col ? "3px solid #1c1917" : "2px solid transparent",
                  outline: form.color === col ? "2px solid white" : "none", outlineOffset: "-3px",
                }} />
              ))}
              <label title="Pick a custom colour" style={{
                position: "relative", overflow: "hidden", cursor: "pointer", flexShrink: 0,
                display: "inline-flex", alignItems: "center", gap: "0.3rem",
                padding: "0.2rem 0.6rem", borderRadius: "9999px",
                border: !COLORS.includes(form.color ?? "") ? "2px solid #1c1917" : "1px solid #d4d4d4",
                background: !COLORS.includes(form.color ?? "") ? form.color ?? "#fff" : "#f5f5f4",
                color: !COLORS.includes(form.color ?? "") ? "#fff" : "#374151",
                fontSize: "0.75rem", fontWeight: 500,
              }}>
                <span style={{ fontSize: "0.875rem" }}>🎨</span>
                More colours
                <input type="color" value={form.color ?? "#6b7280"} onChange={e => set("color", e.target.value)}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }} />
              </label>
            </div>
          </div>
          <div>
            <label className="form-label">Sort order (optional)</label>
            <input className="form-input" type="number" value={form.sort_order} onChange={e => set("sort_order", e.target.value)} placeholder="leave blank to skip" />
            <p style={{ fontSize: "0.7rem", color: "#78716c", marginTop: "0.25rem" }}>
              Optional — controls the order rooms appear in lists. Leave blank if you don&apos;t care about ordering.
            </p>
          </div>
          <div>
            <label className="form-label">Description</label>
            <textarea className="form-input" value={form.description} onChange={e => set("description", e.target.value)} rows={2} style={{ resize: "vertical" }} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
            <input type="checkbox" checked={form.is_active} onChange={e => set("is_active", e.target.checked)} />
            Active
          </label>
          {error && <p style={{ color: "#dc2626", fontSize: "0.8125rem" }}>{error}</p>}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? "Saving…" : editId ? "Save changes" : "Add room"}
            </button>
            {editId && <button onClick={cancelEdit} className="btn-secondary">Cancel</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
