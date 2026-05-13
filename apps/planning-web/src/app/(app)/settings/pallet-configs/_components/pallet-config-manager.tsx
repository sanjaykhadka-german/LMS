"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Template = {
  id: string;
  name: string;
  description: string | null;
  ti: number | null;
  hi: number | null;
  pallet_type: string;
  pallet_length_mm: number | null;
  pallet_width_mm: number | null;
  pallet_height_mm: number | null;
  max_weight_kg: number | null;
  is_active: boolean;
  sort_order: number;
};

const EMPTY: Omit<Template, "id"> = {
  name: "", description: "", ti: null, hi: null,
  pallet_type: "plain", pallet_length_mm: null, pallet_width_mm: null,
  pallet_height_mm: null, max_weight_kg: null,
  is_active: true, sort_order: 0,
};

function n(v: number | null) { return v != null ? String(v) : ""; }

export default function PalletConfigManager({ initialTemplates, tenantId }: { initialTemplates: Template[]; tenantId: string }) {
  const supabase = createClient();
  const router = useRouter();

  const [templates, setTemplates] = useState(initialTemplates);
  const [editing, setEditing] = useState<string | null>(null); // id or "new"
  const [form, setForm] = useState<Omit<Template, "id">>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function openNew() {
    setForm({ ...EMPTY, sort_order: templates.length });
    setEditing("new");
  }

  function openEdit(t: Template) {
    setForm({ name: t.name, description: t.description ?? "", ti: t.ti, hi: t.hi, pallet_type: t.pallet_type, pallet_length_mm: t.pallet_length_mm, pallet_width_mm: t.pallet_width_mm, pallet_height_mm: t.pallet_height_mm, max_weight_kg: t.max_weight_kg, is_active: t.is_active, sort_order: t.sort_order });
    setEditing(t.id);
  }

  function fv(k: keyof Omit<Template, "id">) {
    const v = form[k];
    return v != null ? String(v) : "";
  }

  function setNum(k: keyof Omit<Template, "id">, v: string) {
    setForm(f => ({ ...f, [k]: v ? parseFloat(v) : null }));
  }

  async function save() {
    if (!form.name.trim()) { setError("Name is required."); return; }
    setSaving(true); setError("");
    const payload = {
      tenant_id: tenantId,
      name: form.name.trim(),
      description: form.description || null,
      ti: form.ti,
      hi: form.hi,
      pallet_type: form.pallet_type,
      pallet_length_mm: form.pallet_length_mm,
      pallet_width_mm: form.pallet_width_mm,
      pallet_height_mm: form.pallet_height_mm,
      max_weight_kg: form.max_weight_kg,
      is_active: form.is_active,
      sort_order: form.sort_order,
      updated_at: new Date().toISOString(),
    };

    if (editing === "new") {
      const { data, error: err } = await supabase.from("pallet_config_templates").insert(payload).select().single();
      if (err) { setError(err.message); setSaving(false); return; }
      setTemplates(prev => [...prev, data as Template]);
    } else {
      const { error: err } = await supabase.from("pallet_config_templates").update(payload).eq("id", editing!);
      if (err) { setError(err.message); setSaving(false); return; }
      setTemplates(prev => prev.map(t => t.id === editing ? { ...t, ...payload, id: t.id } : t));
    }

    setSaving(false);
    setEditing(null);
  }

  async function toggleActive(t: Template) {
    await supabase.from("pallet_config_templates").update({ is_active: !t.is_active }).eq("id", t.id);
    setTemplates(prev => prev.map(x => x.id === t.id ? { ...x, is_active: !x.is_active } : x));
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Delete this template?")) return;
    await supabase.from("pallet_config_templates").delete().eq("id", id);
    setTemplates(prev => prev.filter(t => t.id !== id));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
        <button onClick={openNew} className="btn-primary">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Template
        </button>
      </div>

      {templates.length === 0 && editing !== "new" ? (
        <div style={{ textAlign: "center", padding: "4rem 2rem", color: "#78716c" }}>
          <p style={{ margin: "0 0 1.5rem", fontWeight: 600 }}>No pallet templates yet</p>
          <button onClick={openNew} className="btn-primary">Create First Template</button>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #292524" }}>
                <th style={{ padding: "0.625rem 1rem", textAlign: "left", color: "#78716c", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>Name</th>
                <th style={{ padding: "0.625rem 1rem", textAlign: "left", color: "#78716c", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>Ti × Hi</th>
                <th style={{ padding: "0.625rem 1rem", textAlign: "left", color: "#78716c", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>Pallet Type</th>
                <th style={{ padding: "0.625rem 1rem", textAlign: "left", color: "#78716c", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>Dimensions (L×W×H mm)</th>
                <th style={{ padding: "0.625rem 1rem", textAlign: "left", color: "#78716c", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>Status</th>
                <th style={{ padding: "0.625rem 1rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t, i) => (
                <tr key={t.id} style={{ borderBottom: i < templates.length - 1 ? "1px solid #1c1917" : "none" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#1c1917")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <div style={{ fontWeight: 600, color: "#f5f5f4" }}>{t.name}</div>
                    {t.description && <div style={{ fontSize: "0.75rem", color: "#78716c" }}>{t.description}</div>}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", color: "#a8a29e" }}>
                    {t.ti && t.hi ? `${t.ti} × ${t.hi} = ${t.ti * t.hi} units` : "—"}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", color: "#a8a29e", textTransform: "uppercase", fontSize: "0.75rem" }}>{t.pallet_type}</td>
                  <td style={{ padding: "0.75rem 1rem", color: "#a8a29e", fontSize: "0.75rem" }}>
                    {t.pallet_length_mm ? `${t.pallet_length_mm}×${t.pallet_width_mm}×${t.pallet_height_mm ?? "?"}` : "—"}
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <button onClick={() => toggleActive(t)} style={{ padding: "0.2rem 0.625rem", borderRadius: "9999px", border: "none", cursor: "pointer", fontSize: "0.6875rem", fontWeight: 600, background: t.is_active ? "rgba(34,197,94,0.15)" : "rgba(120,113,108,0.15)", color: t.is_active ? "#4ade80" : "#78716c" }}>
                      {t.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                      <button onClick={() => openEdit(t)} style={{ padding: "0.25rem 0.625rem", borderRadius: "0.375rem", background: "#292524", border: "1px solid #292524", color: "#f5f5f4", cursor: "pointer", fontSize: "0.75rem" }}>Edit</button>
                      <button onClick={() => deleteTemplate(t.id)} style={{ padding: "0.25rem 0.625rem", borderRadius: "0.375rem", background: "transparent", border: "1px solid #292524", color: "#f87171", cursor: "pointer", fontSize: "0.75rem" }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Editor panel */}
      {editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "4rem", overflowY: "auto" }}>
          <div style={{ background: "#231f1e", border: "1px solid #292524", borderRadius: "0.75rem", padding: "1.5rem", width: "560px", maxWidth: "95vw" }}>
            <h2 style={{ margin: "0 0 1.25rem", fontSize: "1.0625rem", fontWeight: 700, color: "#f5f5f4" }}>
              {editing === "new" ? "New Pallet Template" : "Edit Pallet Template"}
            </h2>

            {error && <div style={{ marginBottom: "1rem", padding: "0.625rem 0.875rem", borderRadius: "0.375rem", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: "0.875rem" }}>{error}</div>}

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <FormRow label="Name *">
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input" style={{ width: "100%", boxSizing: "border-box" }} />
              </FormRow>
              <FormRow label="Description">
                <input type="text" value={form.description ?? ""} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input" style={{ width: "100%", boxSizing: "border-box" }} />
              </FormRow>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
                <FormRow label="Ti">
                  <input type="number" value={fv("ti")} onChange={e => setNum("ti", e.target.value)} className="input" style={{ width: "100%", boxSizing: "border-box" }} />
                </FormRow>
                <FormRow label="Hi">
                  <input type="number" value={fv("hi")} onChange={e => setNum("hi", e.target.value)} className="input" style={{ width: "100%", boxSizing: "border-box" }} />
                </FormRow>
                <FormRow label="Units/Pallet">
                  <div style={{ padding: "0.5rem 0.75rem", background: "#141211", border: "1px solid #1c1917", borderRadius: "0.375rem", color: "#78716c", fontSize: "0.875rem" }}>
                    {form.ti && form.hi ? (form.ti * form.hi) : "—"}
                  </div>
                </FormRow>
              </div>
              <FormRow label="Pallet Type">
                <select value={form.pallet_type} onChange={e => setForm(f => ({ ...f, pallet_type: e.target.value }))} className="input" style={{ width: "100%" }}>
                  <option value="plain">Plain</option>
                  <option value="chep">CHEP</option>
                  <option value="loscam">Loscam</option>
                  <option value="other">Other</option>
                </select>
              </FormRow>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "1rem" }}>
                <FormRow label="Length (mm)">
                  <input type="number" value={fv("pallet_length_mm")} onChange={e => setNum("pallet_length_mm", e.target.value)} className="input" style={{ width: "100%", boxSizing: "border-box" }} />
                </FormRow>
                <FormRow label="Width (mm)">
                  <input type="number" value={fv("pallet_width_mm")} onChange={e => setNum("pallet_width_mm", e.target.value)} className="input" style={{ width: "100%", boxSizing: "border-box" }} />
                </FormRow>
                <FormRow label="Height (mm)">
                  <input type="number" value={fv("pallet_height_mm")} onChange={e => setNum("pallet_height_mm", e.target.value)} className="input" style={{ width: "100%", boxSizing: "border-box" }} />
                </FormRow>
                <FormRow label="Max Weight (kg)">
                  <input type="number" step="0.001" value={fv("max_weight_kg")} onChange={e => setNum("max_weight_kg", e.target.value)} className="input" style={{ width: "100%", boxSizing: "border-box" }} />
                </FormRow>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <label style={{ fontSize: "0.8125rem", color: "#a8a29e" }}>
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} style={{ marginRight: "0.5rem" }} />
                  Active
                </label>
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem", justifyContent: "flex-end" }}>
              <button onClick={() => { setEditing(null); setError(""); }} style={{ padding: "0.5rem 1rem", background: "transparent", border: "1px solid #292524", borderRadius: "0.5rem", color: "#78716c", cursor: "pointer", fontSize: "0.875rem" }}>
                Cancel
              </button>
              <button onClick={save} disabled={saving} className="btn-primary">
                {saving ? "Saving…" : "Save Template"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#78716c", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</label>
      {children}
    </div>
  );
}
