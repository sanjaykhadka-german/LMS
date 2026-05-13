"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

const RM_CATEGORIES = ["Pork", "Beef", "Lamb", "Poultry", "Curing", "Seasoning", "Casings", "Packaging", "Other"];

export default function NewRawMaterialPage() {
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: "", name: "", description: "", category: "Pork",
    unit: "kg", supplier: "", supplier_code: "",
    spec_origin: "", spec_fat_content: "", spec_protein: "",
    spec_moisture: "", spec_ph: "", spec_microbiological: "",
    spec_allergens: "", spec_storage_temp: "0–4°C", spec_shelf_life: "",
    spec_notes: "",
    min_stock_level: "0",
  });

  function set(field: string, value: string) { setForm(f => ({ ...f, [field]: value })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { data, error } = await supabase
      .from("raw_materials")
      .insert({
        ...form,
        min_stock_level: parseFloat(form.min_stock_level),
        description: form.description || null,
        supplier: form.supplier || null,
        supplier_code: form.supplier_code || null,
        spec_origin: form.spec_origin || null,
        spec_fat_content: form.spec_fat_content || null,
        spec_protein: form.spec_protein || null,
        spec_moisture: form.spec_moisture || null,
        spec_ph: form.spec_ph || null,
        spec_microbiological: form.spec_microbiological || null,
        spec_allergens: form.spec_allergens || null,
        spec_storage_temp: form.spec_storage_temp || null,
        spec_shelf_life: form.spec_shelf_life || null,
        spec_notes: form.spec_notes || null,
      })
      .select().single();
    if (error) { setError(error.message); setSaving(false); }
    else router.push(`/raw-materials/${data.id}`);
  }

  const inputProps = (field: string, type = "text") => ({
    className: "form-input",
    type,
    value: form[field as keyof typeof form],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(field, e.target.value),
  });

  return (
    <div style={{ maxWidth: "720px" }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">New Raw Material</h1>
          <p className="page-subtitle">Register a raw material with full specification</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", marginTop: 0, marginBottom: "1rem" }}>Basic Information</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Material Code *</label>
              <input {...inputProps("code")} placeholder="e.g. RM011" required />
            </div>
            <div>
              <label className="form-label">Name *</label>
              <input {...inputProps("name")} placeholder="e.g. Pork Loin (Boneless)" required />
            </div>
            <div>
              <label className="form-label">Category</label>
              <select {...inputProps("category")} className="form-select">
                {RM_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Description</label>
              <input {...inputProps("description")} placeholder="Optional description…" />
            </div>
            <div>
              <label className="form-label">Unit</label>
              <input {...inputProps("unit")} placeholder="kg" />
            </div>
            <div>
              <label className="form-label">Minimum Stock Level</label>
              <input {...inputProps("min_stock_level", "number")} min="0" step="0.001" />
            </div>
            <div>
              <label className="form-label">Supplier</label>
              <input {...inputProps("supplier")} placeholder="Supplier name" />
            </div>
            <div>
              <label className="form-label">Supplier Code</label>
              <input {...inputProps("supplier_code")} placeholder="Supplier's product code" />
            </div>
          </div>
        </div>

        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", marginTop: 0, marginBottom: "0.25rem" }}>Raw Material Specification</h2>
          <p style={{ fontSize: "0.8125rem", color: "#78716c", marginBottom: "1rem", marginTop: 0 }}>Fill in applicable fields for the material spec sheet</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            {[
              ["spec_origin", "Origin / Source", "e.g. Australian pork"],
              ["spec_fat_content", "Fat Content", "e.g. 20–30%"],
              ["spec_protein", "Protein", "e.g. ≥18%"],
              ["spec_moisture", "Moisture", "e.g. ≤70%"],
              ["spec_ph", "pH", "e.g. 5.6–6.2"],
              ["spec_microbiological", "Microbiological Standards", "e.g. TPC <100,000 cfu/g"],
              ["spec_allergens", "Allergens", "e.g. None declared"],
              ["spec_storage_temp", "Storage Temperature", "e.g. 0–4°C"],
              ["spec_shelf_life", "Shelf Life", "e.g. 5 days"],
            ].map(([field, label, placeholder]) => (
              <div key={field}>
                <label className="form-label">{label}</label>
                <input {...inputProps(field)} placeholder={placeholder} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: "1rem" }}>
            <label className="form-label">Additional Notes</label>
            <textarea {...inputProps("spec_notes")} className="form-input" rows={3} placeholder="Any additional specification notes…" style={{ resize: "vertical" }} />
          </div>
        </div>

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", padding: "0.75rem", color: "#991b1b", fontSize: "0.875rem" }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Material"}</button>
          <Link href="/raw-materials" className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
