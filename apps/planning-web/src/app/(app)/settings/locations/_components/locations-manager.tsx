"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BarcodeChip } from "@/components/barcode-chip";

type Department = { id: string; name: string };
type Room = {
  id: string;
  name: string;
  code: string | null;
  department_id: string;
  department?: Department | null;
};

type Location = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  sort_order: number | null;
  is_active: boolean;
  room_id: string;
  barcode: string | null;
  color: string | null;
  room?: Room | null;
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
  room_id: "",
  color: COLORS[0],
};

export default function LocationsManager({
  initialLocations, rooms,
}: {
  initialLocations: Location[];
  rooms: Room[];
}) {
  const supabase = createClient();
  const [locations, setLocations] = useState<Location[]>(initialLocations);
  const [form, setForm] = useState(BLANK);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterRoomId, setFilterRoomId] = useState<string>("");

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const startEdit = (l: Location) => {
    setEditId(l.id);
    setForm({
      name: l.name,
      code: l.code ?? "",
      description: l.description ?? "",
      sort_order: String(l.sort_order ?? ""),
      is_active: l.is_active,
      room_id: l.room_id,
      color: l.color ?? COLORS[0],
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
    if (!form.room_id) { setError("Room is required — locations must sit inside a room"); return; }
    setSaving(true); setError(null);
    const payload = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      description: form.description.trim() || null,
      sort_order: form.sort_order !== "" ? Number(form.sort_order) : null,
      is_active: form.is_active,
      room_id: form.room_id,
      color: form.color || null,
    };

    if (editId) {
      const { error: e } = await supabase.from("locations").update(payload).eq("id", editId);
      if (e) { setError(e.message); setSaving(false); return; }
      const room = rooms.find(r => r.id === payload.room_id) ?? null;
      setLocations(prev => prev.map(l => l.id === editId ? { ...l, ...payload, room } : l));
      cancelEdit();
    } else {
      const tenantId = await getTenantId();
      const { data, error: e } = await supabase
        .from("locations")
        .insert({ ...payload, tenant_id: tenantId })
        .select("id, name, code, description, sort_order, is_active, room_id, barcode, color, room:room_id(id, name, code, department_id, department:department_id(id, name))")
        .single();
      if (e || !data) { setError(e?.message ?? "Failed to create"); setSaving(false); return; }
      setLocations(prev => [...prev, data as unknown as Location]);
      setForm(BLANK);
    }
    setSaving(false);
  };

  const handleToggle = async (l: Location) => {
    const { error: e } = await supabase.from("locations").update({ is_active: !l.is_active }).eq("id", l.id);
    if (!e) setLocations(prev => prev.map(x => x.id === l.id ? { ...x, is_active: !l.is_active } : x));
  };

  const selectedRoom = rooms.find(r => r.id === form.room_id);
  const visibleLocations = filterRoomId
    ? locations.filter(l => l.room_id === filterRoomId)
    : locations;

  // Group by room for display when no filter is set
  const grouped: Record<string, Location[]> = {};
  for (const l of visibleLocations) {
    const key = l.room_id;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(l);
  }
  const groupOrder = Object.keys(grouped).sort((a, b) => {
    const ra = rooms.find(r => r.id === a)?.name ?? "";
    const rb = rooms.find(r => r.id === b)?.name ?? "";
    return ra.localeCompare(rb);
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "1.5rem", alignItems: "start" }}>
      {/* List */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, flex: 1 }}>Locations ({locations.length})</h2>
          <label style={{ fontSize: "0.8125rem", color: "#57534e" }}>
            Filter by room:&nbsp;
            <select className="form-select" value={filterRoomId} onChange={e => setFilterRoomId(e.target.value)} style={{ display: "inline-block", width: "auto", padding: "0.25rem 0.5rem", fontSize: "0.8125rem" }}>
              <option value="">All rooms</option>
              {rooms.map(r => (
                <option key={r.id} value={r.id}>{r.name}{r.department?.name ? ` — ${r.department.name}` : ""}</option>
              ))}
            </select>
          </label>
        </div>

        {visibleLocations.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
            {locations.length === 0
              ? "No locations yet. Add one in the panel on the right."
              : "No locations match this filter."}
          </div>
        ) : (
          <div>
            {groupOrder.map(roomId => {
              const room = rooms.find(r => r.id === roomId);
              const items = grouped[roomId];
              return (
                <div key={roomId} style={{ borderBottom: "1px solid #f5f5f4" }}>
                  <div style={{ padding: "0.5rem 1rem", background: "#fafaf9", fontSize: "0.75rem", fontWeight: 600, color: "#57534e", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span>{room?.name ?? "Unknown room"}</span>
                    {room?.department?.name && (
                      <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#a8a29e", fontSize: "0.75rem" }}>· {room.department.name}</span>
                    )}
                    <span style={{ fontWeight: 400, color: "#a8a29e", fontSize: "0.6875rem", marginLeft: "auto" }}>{items.length} location{items.length !== 1 ? "s" : ""}</span>
                  </div>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Name</th>
                        <th>Barcode</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(l => (
                        <tr key={l.id} style={{ opacity: l.is_active ? 1 : 0.55 }}>
                          <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{l.code ?? "—"}</td>
                          <td style={{ fontWeight: 500 }}>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                              {l.color && <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: l.color, flexShrink: 0, display: "inline-block" }} />}
                              <span>{l.name}</span>
                            </div>
                          </td>
                          <td style={{ fontSize: "0.8125rem", color: "#57534e" }}>
                            <BarcodeChip code={l.barcode} />
                          </td>
                          <td>
                            <span className={`badge ${l.is_active ? "badge-green" : "badge-gray"}`} style={{ fontSize: "0.6875rem" }}>
                              {l.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td style={{ display: "flex", gap: "0.375rem" }}>
                            {l.barcode && (
                              <Link
                                href={`/labels/print?code=${encodeURIComponent(l.barcode)}&name=${encodeURIComponent(l.name)}&sub=${encodeURIComponent((room?.name ?? "") + (room?.department?.name ? " · " + room.department.name : ""))}`}
                                target="_blank"
                                className="btn-secondary"
                                style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}
                              >
                                Label
                              </Link>
                            )}
                            <button onClick={() => startEdit(l)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}>Edit</button>
                            <button onClick={() => handleToggle(l)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}>
                              {l.is_active ? "Deactivate" : "Activate"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Form */}
      <div className="card">
        <h2 style={{ margin: "0 0 0.875rem", fontSize: "1rem", fontWeight: 600 }}>
          {editId ? "Edit Location" : "Add Location"}
        </h2>

        {rooms.length === 0 && (
          <div style={{ marginBottom: "0.75rem", padding: "0.625rem 0.75rem", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "0.5rem", fontSize: "0.8125rem", color: "#92400e" }}>
            You need at least one active room before you can create locations. <Link href="/settings/rooms" style={{ color: "#92400e", textDecoration: "underline" }}>Add a room →</Link>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          <div>
            <label className="form-label">Room *</label>
            <select className="form-select" value={form.room_id} onChange={e => set("room_id", e.target.value)} disabled={rooms.length === 0}>
              <option value="">— Pick a room —</option>
              {rooms.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.department?.name ? ` — ${r.department.name}` : ""}
                </option>
              ))}
            </select>
            {selectedRoom?.department?.name && (
              <p style={{ fontSize: "0.7rem", color: "#78716c", marginTop: "0.25rem" }}>
                Department: <strong>{selectedRoom.department.name}</strong> (inherited from the room)
              </p>
            )}
          </div>

          <div>
            <label className="form-label">Name *</label>
            <input className="form-input" value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Shelf A · Bin 3" />
          </div>

          <div>
            <label className="form-label">Code</label>
            <input className="form-input" value={form.code} onChange={e => set("code", e.target.value)} placeholder="auto-generated on save (e.g. L-001)" style={{ fontFamily: "monospace" }} />
            <p style={{ fontSize: "0.7rem", color: "#78716c", marginTop: "0.25rem" }}>
              Leave blank for an auto-numbered code (L-001, L-002 …). Or set your own short code to type into stocktakes by hand.
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
          </div>

          <div>
            <label className="form-label">Description</label>
            <textarea className="form-input" value={form.description} onChange={e => set("description", e.target.value)} rows={2} style={{ resize: "vertical" }} />
          </div>

          <p style={{ fontSize: "0.7rem", color: "#78716c", margin: 0 }}>
            A unique barcode (LOC-XXXXXX) is generated automatically when you save.
          </p>

          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
            <input type="checkbox" checked={form.is_active} onChange={e => set("is_active", e.target.checked)} />
            Active
          </label>

          {error && <p style={{ color: "#dc2626", fontSize: "0.8125rem" }}>{error}</p>}

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
            <button onClick={handleSave} disabled={saving || rooms.length === 0} className="btn-primary">
              {saving ? "Saving…" : editId ? "Save changes" : "Add location"}
            </button>
            {editId && <button onClick={cancelEdit} className="btn-secondary">Cancel</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
