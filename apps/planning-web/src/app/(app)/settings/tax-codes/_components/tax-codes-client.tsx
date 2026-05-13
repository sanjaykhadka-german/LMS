"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TaxCode } from "@/lib/types";

const EMPTY_FORM = {
  name: "",
  rate_pct: "0",
  applies_to: "both" as "purchase" | "sales" | "both",
  is_default_purchase: false,
  is_default_sales: false,
  notes: "",
};

export default function TaxCodesClient({ initialTaxCodes }: { initialTaxCodes: TaxCode[] }) {
  const supabase = createClient();
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>(initialTaxCodes);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function startEdit(tc: TaxCode) {
    setEditingId(tc.id);
    setForm({
      name: tc.name,
      rate_pct: String(tc.rate_pct),
      applies_to: tc.applies_to,
      is_default_purchase: tc.is_default_purchase,
      is_default_sales: tc.is_default_sales,
      notes: tc.notes ?? "",
    });
    setShowForm(true);
    setError(null);
  }

  function cancel() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(false);
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name.trim(),
      rate_pct: parseFloat(form.rate_pct) || 0,
      applies_to: form.applies_to,
      is_default_purchase: form.is_default_purchase,
      is_default_sales: form.is_default_sales,
      notes: form.notes.trim() || null,
    };

    if (editingId) {
      const { data, error: err } = await supabase
        .from("tax_codes")
        .update(payload)
        .eq("id", editingId)
        .select()
        .single();
      if (err) { setError(err.message); setSaving(false); return; }
      setTaxCodes(tc => tc.map(t => t.id === editingId ? data as TaxCode : t));
    } else {
      const { data, error: err } = await supabase
        .from("tax_codes")
        .insert(payload)
        .select()
        .single();
      if (err) { setError(err.message); setSaving(false); return; }
      setTaxCodes(tc => [...tc, data as TaxCode]);
    }

    cancel();
    setSaving(false);
  }

  async function toggleActive(tc: TaxCode) {
    const { data, error: err } = await supabase
      .from("tax_codes")
      .update({ is_active: !tc.is_active })
      .eq("id", tc.id)
      .select()
      .single();
    if (!err && data) {
      setTaxCodes(list => list.map(t => t.id === tc.id ? data as TaxCode : t));
    }
  }

  const appliesToLabel = (v: string) =>
    v === "purchase" ? "Purchases only" : v === "sales" ? "Sales only" : "Both";

  return (
    <div>
      {/* Table */}
      <div className="card" style={{ padding: 0, marginBottom: "1.5rem" }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Tax Code List</h2>
          {!showForm && (
            <button
              onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); }}
              className="btn-primary"
              style={{ fontSize: "0.8125rem" }}
            >
              + Add Tax Code
            </button>
          )}
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Rate</th>
              <th>Applies To</th>
              <th>Default Purchase</th>
              <th>Default Sales</th>
              <th>Status</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {taxCodes.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
                  No tax codes yet. Add one above.
                </td>
              </tr>
            )}
            {taxCodes.map(tc => (
              <tr key={tc.id} style={{ opacity: tc.is_active ? 1 : 0.5 }}>
                <td style={{ fontWeight: 500 }}>{tc.name}</td>
                <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{tc.rate_pct}%</td>
                <td>
                  <span className="badge badge-gray" style={{ fontSize: "0.6875rem" }}>
                    {appliesToLabel(tc.applies_to)}
                  </span>
                </td>
                <td>
                  {tc.is_default_purchase && <span className="badge badge-blue" style={{ fontSize: "0.6875rem" }}>Default</span>}
                </td>
                <td>
                  {tc.is_default_sales && <span className="badge badge-green" style={{ fontSize: "0.6875rem" }}>Default</span>}
                </td>
                <td>
                  <button
                    onClick={() => toggleActive(tc)}
                    style={{
                      padding: "0.2rem 0.5rem", fontSize: "0.6875rem", borderRadius: "0.25rem",
                      border: `1px solid ${tc.is_active ? "#bbf7d0" : "#e7e5e4"}`,
                      background: tc.is_active ? "#f0fdf4" : "#fafaf9",
                      color: tc.is_active ? "#166534" : "#78716c",
                      cursor: "pointer",
                    }}
                  >
                    {tc.is_active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td style={{ fontSize: "0.8125rem", color: "#78716c", maxWidth: "240px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tc.notes ?? "—"}
                </td>
                <td>
                  <button
                    onClick={() => startEdit(tc)}
                    className="btn-secondary"
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>
            {editingId ? "Edit Tax Code" : "New Tax Code"}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label className="form-label">Name *</label>
              <input
                className="form-input"
                value={form.name}
                onChange={e => set("name", e.target.value)}
                placeholder="e.g. GST 10%, GST-Free, VAT 19%"
                required
              />
            </div>
            <div>
              <label className="form-label">Rate (%)</label>
              <input
                className="form-input"
                value={form.rate_pct}
                onChange={e => set("rate_pct", e.target.value)}
                type="number" min="0" max="100" step="0.01"
                placeholder="e.g. 10"
              />
            </div>
            <div>
              <label className="form-label">Applies To</label>
              <select
                className="form-select"
                value={form.applies_to}
                onChange={e => set("applies_to", e.target.value as "purchase" | "sales" | "both")}
              >
                <option value="both">Both purchases &amp; sales</option>
                <option value="purchase">Purchases only</option>
                <option value="sales">Sales only</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: "2rem", marginBottom: "1rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.is_default_purchase}
                onChange={e => set("is_default_purchase", e.target.checked)}
              />
              Default for new purchase lines
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.is_default_sales}
                onChange={e => set("is_default_sales", e.target.checked)}
              />
              Default for new sales lines
            </label>
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label className="form-label">Notes (optional)</label>
            <input
              className="form-input"
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
              placeholder="e.g. Applies to standard-rated processed food products"
            />
          </div>
          {error && (
            <div style={{ marginBottom: "0.75rem", padding: "0.625rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#991b1b", fontSize: "0.875rem" }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: "0.625rem" }}>
            <button onClick={handleSave} className="btn-primary" disabled={saving || !form.name.trim()}>
              {saving ? "Saving…" : editingId ? "Save Changes" : "Add Tax Code"}
            </button>
            <button onClick={cancel} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
