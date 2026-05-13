"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface ItemTypeRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  color: string;
  is_purchasable: boolean;
  can_have_bom: boolean;
  is_sellable: boolean;
  is_producible: boolean;
  sort_order: number;
  is_active: boolean;
}

type FormState = {
  code: string;
  name: string;
  description: string;
  color: string;
  is_purchasable: boolean;
  can_have_bom: boolean;
  is_sellable: boolean;
  is_producible: boolean;
  sort_order: string;
};

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  description: "",
  color: "#6B7280",
  is_purchasable: false,
  can_have_bom: false,
  is_sellable: false,
  is_producible: false,
  sort_order: "0",
};

const FLAG_LABELS: { key: keyof Pick<FormState, "is_purchasable" | "can_have_bom" | "is_sellable" | "is_producible">; label: string; hint: string }[] = [
  { key: "is_purchasable", label: "Purchasable", hint: "Appears in stocktakes and purchase orders" },
  { key: "can_have_bom", label: "Can have BOM", hint: "Allows a bill of materials to be attached" },
  { key: "is_sellable", label: "Sellable", hint: "Can appear on customer orders / dispatch" },
  { key: "is_producible", label: "Producible", hint: "Can be the output of a production order" },
];

export default function ItemTypesManager({ initialItemTypes }: { initialItemTypes: ItemTypeRow[] }) {
  const supabase = createClient();
  const [itemTypes, setItemTypes] = useState<ItemTypeRow[]>(initialItemTypes);
  const [editing, setEditing] = useState<string | null>(null); // id or "new"
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startNew() {
    setEditing("new");
    setForm({ ...EMPTY_FORM, sort_order: String(Math.max(0, ...itemTypes.map(t => t.sort_order)) + 10) });
    setError(null);
  }

  function startEdit(t: ItemTypeRow) {
    setEditing(t.id);
    setForm({
      code: t.code,
      name: t.name,
      description: t.description ?? "",
      color: t.color,
      is_purchasable: t.is_purchasable,
      can_have_bom: t.can_have_bom,
      is_sellable: t.is_sellable,
      is_producible: t.is_producible,
      sort_order: String(t.sort_order),
    });
    setError(null);
  }

  function cancel() {
    setEditing(null);
    setError(null);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!form.code.trim() || !form.name.trim()) {
      setError("Code and name are required.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      code: form.code.trim().toLowerCase().replace(/\s+/g, "_"),
      name: form.name.trim(),
      description: form.description || null,
      color: form.color,
      is_purchasable: form.is_purchasable,
      can_have_bom: form.can_have_bom,
      is_sellable: form.is_sellable,
      is_producible: form.is_producible,
      sort_order: parseInt(form.sort_order) || 0,
    };

    if (editing === "new") {
      const { data, error: err } = await supabase
        .from("item_types")
        .insert(payload)
        .select("id, code, name, description, color, is_purchasable, can_have_bom, is_sellable, is_producible, sort_order, is_active")
        .single();
      if (err) { setError(err.message); setSaving(false); return; }
      setItemTypes(prev => [...prev, data].sort((a, b) => a.sort_order - b.sort_order));
    } else {
      const { data, error: err } = await supabase
        .from("item_types")
        .update(payload)
        .eq("id", editing!)
        .select("id, code, name, description, color, is_purchasable, can_have_bom, is_sellable, is_producible, sort_order, is_active")
        .single();
      if (err) { setError(err.message); setSaving(false); return; }
      setItemTypes(prev => prev.map(t => t.id === editing ? data : t).sort((a, b) => a.sort_order - b.sort_order));
    }

    setSaving(false);
    setEditing(null);
  }

  async function toggleActive(t: ItemTypeRow) {
    const { error: err } = await supabase
      .from("item_types")
      .update({ is_active: !t.is_active })
      .eq("id", t.id);
    if (err) { alert(err.message); return; }
    setItemTypes(prev => prev.map(x => x.id === t.id ? { ...x, is_active: !t.is_active } : x));
  }

  return (
    <div>
      {/* Add button */}
      <div style={{ marginBottom: "1rem" }}>
        <button className="btn-primary" onClick={startNew} disabled={editing !== null}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Item Type
        </button>
      </div>

      {/* Add / Edit form */}
      {editing !== null && (
        <div className="card" style={{ marginBottom: "1.5rem", borderLeft: "3px solid #b91c1c" }}>
          <h3 style={{ margin: "0 0 1rem", fontSize: "0.9375rem", fontWeight: 600 }}>
            {editing === "new" ? "New Item Type" : "Edit Item Type"}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <div>
              <label className="form-label">Code *</label>
              <input
                className="form-input"
                value={form.code}
                onChange={e => setField("code", e.target.value)}
                placeholder="e.g. raw_material"
                disabled={editing !== "new"} // code is immutable once created
              />
              <p style={{ fontSize: "0.75rem", color: "#a8a29e", marginTop: "0.25rem" }}>
                Lowercase, underscores. Cannot change after creation.
              </p>
            </div>
            <div>
              <label className="form-label">Name *</label>
              <input
                className="form-input"
                value={form.name}
                onChange={e => setField("name", e.target.value)}
                placeholder="e.g. Raw Material"
              />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr 80px", gap: "0.75rem", marginBottom: "1rem" }}>
            <div>
              <label className="form-label">Description</label>
              <input
                className="form-input"
                value={form.description}
                onChange={e => setField("description", e.target.value)}
                placeholder="Optional — shown as a tooltip"
              />
            </div>
            <div>
              <label className="form-label">Colour</label>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="color"
                  value={form.color}
                  onChange={e => setField("color", e.target.value)}
                  style={{ width: "2.5rem", height: "2.5rem", border: "none", padding: 0, cursor: "pointer", borderRadius: "0.25rem" }}
                />
                <input
                  className="form-input"
                  value={form.color}
                  onChange={e => setField("color", e.target.value)}
                  placeholder="#6B7280"
                  style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}
                />
              </div>
            </div>
            <div>
              <label className="form-label">Sort</label>
              <input
                className="form-input"
                type="number"
                value={form.sort_order}
                onChange={e => setField("sort_order", e.target.value)}
              />
            </div>
          </div>

          {/* Behaviour flags */}
          <div style={{ marginBottom: "1rem" }}>
            <label className="form-label" style={{ marginBottom: "0.5rem", display: "block" }}>Behaviour Flags</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.5rem" }}>
              {FLAG_LABELS.map(({ key, label, hint }) => (
                <label
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.5rem",
                    padding: "0.625rem 0.75rem",
                    borderRadius: "0.375rem",
                    border: `1px solid ${form[key] ? "#b91c1c" : "#e7e5e4"}`,
                    background: form[key] ? "#fef2f2" : "#fafaf9",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form[key] as boolean}
                    onChange={e => setField(key, e.target.checked)}
                    style={{ marginTop: "0.125rem", cursor: "pointer", flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: "0.875rem", fontWeight: 500 }}>{label}</div>
                    <div style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.125rem" }}>{hint}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <p style={{ color: "#b91c1c", fontSize: "0.875rem", marginBottom: "0.75rem" }}>{error}</p>
          )}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn-secondary" onClick={cancel} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e7e5e4", background: "#fafaf9" }}>
              <th style={{ padding: "0.625rem 1rem", textAlign: "left", fontSize: "0.75rem", fontWeight: 600, color: "#78716c", width: 120 }}>Code</th>
              <th style={{ padding: "0.625rem 0.75rem", textAlign: "left", fontSize: "0.75rem", fontWeight: 600, color: "#78716c" }}>Name</th>
              <th style={{ padding: "0.625rem 0.75rem", textAlign: "center", fontSize: "0.75rem", fontWeight: 600, color: "#78716c" }}>Purchasable</th>
              <th style={{ padding: "0.625rem 0.75rem", textAlign: "center", fontSize: "0.75rem", fontWeight: 600, color: "#78716c" }}>Has BOM</th>
              <th style={{ padding: "0.625rem 0.75rem", textAlign: "center", fontSize: "0.75rem", fontWeight: 600, color: "#78716c" }}>Sellable</th>
              <th style={{ padding: "0.625rem 0.75rem", textAlign: "center", fontSize: "0.75rem", fontWeight: 600, color: "#78716c" }}>Producible</th>
              <th style={{ padding: "0.625rem 0.75rem", textAlign: "center", fontSize: "0.75rem", fontWeight: 600, color: "#78716c", width: 80 }}>Sort</th>
              <th style={{ padding: "0.625rem 0.75rem", textAlign: "center", fontSize: "0.75rem", fontWeight: 600, color: "#78716c", width: 80 }}>Status</th>
              <th style={{ padding: "0.625rem 0.75rem", width: 120 }}></th>
            </tr>
          </thead>
          <tbody>
            {itemTypes.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: "2rem", textAlign: "center", color: "#a8a29e", fontSize: "0.875rem" }}>
                  No item types yet. Click "Add Item Type" to create one.
                </td>
              </tr>
            )}
            {itemTypes.map(t => (
              <tr key={t.id} style={{ borderBottom: "1px solid #f5f5f4", opacity: t.is_active ? 1 : 0.55 }}>
                <td style={{ padding: "0.625rem 1rem" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                    <span style={{
                      width: "0.625rem",
                      height: "0.625rem",
                      borderRadius: "50%",
                      background: t.color,
                      flexShrink: 0,
                      display: "inline-block",
                    }} />
                    <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{t.code}</span>
                  </span>
                </td>
                <td style={{ padding: "0.625rem 0.75rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  {t.name}
                  {t.description && (
                    <span style={{ display: "block", fontSize: "0.75rem", color: "#78716c", fontWeight: 400 }}>{t.description}</span>
                  )}
                </td>
                {(["is_purchasable", "can_have_bom", "is_sellable", "is_producible"] as const).map(flag => (
                  <td key={flag} style={{ padding: "0.625rem 0.75rem", textAlign: "center" }}>
                    {t[flag]
                      ? <span style={{ color: "#16a34a", fontSize: "1rem" }}>✓</span>
                      : <span style={{ color: "#d4d4d4", fontSize: "0.875rem" }}>—</span>}
                  </td>
                ))}
                <td style={{ padding: "0.625rem 0.75rem", textAlign: "center", color: "#78716c", fontSize: "0.875rem" }}>{t.sort_order}</td>
                <td style={{ padding: "0.625rem 0.75rem", textAlign: "center" }}>
                  <span className={`badge ${t.is_active ? "badge-green" : "badge-gray"}`} style={{ fontSize: "0.6875rem" }}>
                    {t.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td style={{ padding: "0.625rem 0.75rem", textAlign: "right" }}>
                  <div style={{ display: "flex", gap: "0.375rem", justifyContent: "flex-end" }}>
                    <button
                      className="btn-secondary"
                      style={{ padding: "0.25rem 0.625rem", fontSize: "0.8125rem" }}
                      onClick={() => startEdit(t)}
                      disabled={editing !== null}
                    >
                      Edit
                    </button>
                    <button
                      className="btn-secondary"
                      style={{ padding: "0.25rem 0.625rem", fontSize: "0.8125rem", color: t.is_active ? "#78716c" : "#15803d" }}
                      onClick={() => toggleActive(t)}
                      disabled={editing !== null}
                    >
                      {t.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: "1rem", fontSize: "0.8125rem", color: "#a8a29e" }}>
        Behaviour flags control where each type appears across the app — stocktakes (purchasable), BOM editor (has BOM), dispatch floor (sellable), production orders (producible).
      </p>
    </div>
  );
}
