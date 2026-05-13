"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type SparePart = {
  id: string;
  part_name: string;
  part_number: string | null;
  description: string | null;
  quantity_on_hand: number;
  reorder_level: number | null;
  unit: string;
  supplier_name: string | null;
  unit_cost: number | null;
  location: string | null;
};

const BLANK = {
  part_name: "", part_number: "", description: "",
  quantity_on_hand: "0", reorder_level: "", unit: "each",
  supplier_name: "", supplier_part_no: "", unit_cost: "", location: "",
};

export default function MachineSparePartsPanel({
  machineId, initialParts,
}: { machineId: string; initialParts: SparePart[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  function startEdit(p: SparePart) {
    setEditId(p.id);
    setForm({
      part_name: p.part_name, part_number: p.part_number ?? "", description: p.description ?? "",
      quantity_on_hand: String(p.quantity_on_hand), reorder_level: p.reorder_level != null ? String(p.reorder_level) : "",
      unit: p.unit, supplier_name: p.supplier_name ?? "", supplier_part_no: "",
      unit_cost: p.unit_cost != null ? String(p.unit_cost) : "", location: p.location ?? "",
    });
    setShowForm(true);
  }

  async function save() {
    if (!form.part_name.trim()) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();

    const payload = {
      tenant_id: profile!.tenant_id,
      machine_id: machineId,
      part_name: form.part_name.trim(),
      part_number: form.part_number || null,
      description: form.description || null,
      quantity_on_hand: parseFloat(form.quantity_on_hand) || 0,
      reorder_level: form.reorder_level ? parseFloat(form.reorder_level) : null,
      unit: form.unit || "each",
      supplier_name: form.supplier_name || null,
      unit_cost: form.unit_cost ? parseFloat(form.unit_cost) : null,
      location: form.location || null,
    };

    if (editId) {
      await supabase.from("machine_spare_parts").update(payload).eq("id", editId);
    } else {
      await supabase.from("machine_spare_parts").insert(payload);
    }

    setSaving(false); setShowForm(false); setEditId(null); setForm(BLANK);
    router.refresh();
  }

  async function deletePart(id: string) {
    if (!confirm("Delete this spare part?")) return;
    await supabase.from("machine_spare_parts").delete().eq("id", id);
    router.refresh();
  }

  const lowStock = initialParts.filter(p => p.reorder_level != null && p.quantity_on_hand <= p.reorder_level!);

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>
            Spare Parts
            {lowStock.length > 0 && (
              <span style={{ marginLeft: "0.5rem", background: "#fffbeb", color: "#d97706", border: "1px solid #fcd34d",
                borderRadius: "999px", fontSize: "0.75rem", padding: "0.1rem 0.5rem", fontWeight: 600 }}>
                {lowStock.length} low stock
              </span>
            )}
          </h2>
        </div>
        <button onClick={() => { setShowForm(true); setEditId(null); setForm(BLANK); }} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
          + Add Part
        </button>
      </div>

      {showForm && (
        <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem", padding: "1rem", marginBottom: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <div>
              <label className="form-label">Part Name *</label>
              <input className="form-input" value={form.part_name} onChange={e => set("part_name", e.target.value)} placeholder="e.g. Drive Belt" />
            </div>
            <div>
              <label className="form-label">Part Number</label>
              <input className="form-input" value={form.part_number} onChange={e => set("part_number", e.target.value)}
                style={{ fontFamily: "monospace" }} placeholder="OEM or internal" />
            </div>
            <div>
              <label className="form-label">Unit</label>
              <input className="form-input" value={form.unit} onChange={e => set("unit", e.target.value)} placeholder="each, m, kg…" />
            </div>
            <div>
              <label className="form-label">Qty on Hand</label>
              <input className="form-input" type="number" min="0" step="1" value={form.quantity_on_hand} onChange={e => set("quantity_on_hand", e.target.value)} />
            </div>
            <div>
              <label className="form-label">Reorder Level</label>
              <input className="form-input" type="number" min="0" step="1" value={form.reorder_level}
                onChange={e => set("reorder_level", e.target.value)} placeholder="Alert below this qty" />
            </div>
            <div>
              <label className="form-label">Unit Cost ($)</label>
              <input className="form-input" type="number" min="0" step="0.01" value={form.unit_cost} onChange={e => set("unit_cost", e.target.value)} />
            </div>
            <div>
              <label className="form-label">Supplier</label>
              <input className="form-input" value={form.supplier_name} onChange={e => set("supplier_name", e.target.value)} />
            </div>
            <div>
              <label className="form-label">Storage Location</label>
              <input className="form-input" value={form.location} onChange={e => set("location", e.target.value)} placeholder="e.g. Shelf A3" />
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={save} className="btn-primary" disabled={saving} style={{ fontSize: "0.8125rem" }}>
              {saving ? "Saving…" : editId ? "Update" : "Add Part"}
            </button>
            <button onClick={() => setShowForm(false)} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Cancel</button>
          </div>
        </div>
      )}

      {initialParts.length === 0 ? (
        <p style={{ color: "#78716c", fontSize: "0.875rem" }}>No spare parts listed yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Part Name</th><th>Part No.</th><th>Stock</th><th>Reorder At</th><th>Location</th><th>Unit Cost</th><th></th></tr>
          </thead>
          <tbody>
            {initialParts.map(p => {
              const low = p.reorder_level != null && p.quantity_on_hand <= p.reorder_level;
              return (
                <tr key={p.id}>
                  <td style={{ fontWeight: 500 }}>{p.part_name}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{p.part_number ?? "—"}</td>
                  <td style={{ fontWeight: low ? 600 : 400, color: low ? "#d97706" : "inherit" }}>
                    {p.quantity_on_hand} {p.unit}
                    {low && " ⚠"}
                  </td>
                  <td style={{ color: "#78716c", fontSize: "0.8125rem" }}>{p.reorder_level ?? "—"}</td>
                  <td style={{ color: "#78716c", fontSize: "0.8125rem" }}>{p.location ?? "—"}</td>
                  <td style={{ color: "#78716c", fontSize: "0.8125rem" }}>
                    {p.unit_cost != null ? `$${p.unit_cost.toFixed(2)}` : "—"}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "0.25rem" }}>
                      <button onClick={() => startEdit(p)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}>Edit</button>
                      <button onClick={() => deletePart(p.id)}
                        style={{ fontSize: "0.75rem", background: "none", border: "1px solid #fca5a5",
                          borderRadius: "0.375rem", color: "#dc2626", cursor: "pointer", padding: "0.2rem 0.5rem" }}>Del</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
