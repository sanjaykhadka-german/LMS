"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { traceyStorage } from "@/lib/storage/client";
import Link from "next/link";
import { useUnitsOfMeasure } from "@/lib/hooks/use-reference-data";
import CalcInput from "@/components/calc-input";

// ── Types ─────────────────────────────────────────────────────────────────────

type SupplierItemRow = {
  id: string;
  supplier_item_code: string | null;
  supplier_item_name: string | null;
  unit_price: number | null;
  currency: string | null;
  price_valid_from: string | null;
  price_valid_to: string | null;
  purchase_uom: string | null;
  purchase_uom_qty: number | null;
  min_order_qty: number | null;
  lead_time_days: number | null;
  is_preferred: boolean;
  notes: string | null;
  supplier: { id: string; name: string; code: string | null } | null;
};

type SupplierOption = { id: string; name: string; code: string | null };

type SpecDoc = {
  id: string;
  document_type: string;
  title: string;
  version: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  supplier_id: string | null;
  document_url: string;
  document_name: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  created_at: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  spec_sheet:    "Spec Sheet",
  coa:           "CoA",
  sds:           "SDS",
  allergen_decl: "Allergen Decl",
  nutritional:   "Nutritional",
  micro_report:  "Micro Report",
  supplier_spec: "Supplier Spec",
  other:         "Other",
};

const EMPTY_LINE = {
  supplier_id: "",
  supplier_item_code: "",
  supplier_item_name: "",
  unit_price: "",
  currency: "AUD",
  price_valid_from: "",
  price_valid_to: "",
  purchase_uom: "",
  purchase_uom_qty: "",
  min_order_qty: "",
  lead_time_days: "",
  is_preferred: false,
  notes: "",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileIcon(mime: string | null, name: string) {
  if (!mime) return "📄";
  if (mime.startsWith("image/")) return "🖼";
  if (mime === "application/pdf") return "📕";
  if (mime.includes("word") || name.endsWith(".docx") || name.endsWith(".doc")) return "📝";
  if (mime.includes("excel") || mime.includes("spreadsheet") || name.endsWith(".xlsx") || name.endsWith(".xls")) return "📊";
  return "📄";
}

function formatBytes(b: number | null) {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ItemSuppliersPanel({
  itemId,
  itemUnit,
  initialSuppliers,
  allSuppliers,
  specDocs: initialSpecDocs,
  tenantId,
}: {
  itemId: string;
  itemUnit: string;
  initialSuppliers: SupplierItemRow[];
  allSuppliers: SupplierOption[];
  specDocs: SpecDoc[];
  tenantId: string;
}) {
  const supabase = createClient();
  // Pull the UOM register so the per-supplier "Purchase Unit" dropdown
  // shares the same source of truth as the item-level Purchase / Stock /
  // Batch unit dropdowns.
  const { data: uoms = [] } = useUnitsOfMeasure();
  const [rows, setRows] = useState<SupplierItemRow[]>(initialSuppliers);
  const [form, setForm] = useState(EMPTY_LINE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedSupplierId, setExpandedSupplierId] = useState<string | null>(null);
  const [allSpecDocs, setAllSpecDocs] = useState<SpecDoc[]>(initialSpecDocs);

  function set<K extends keyof typeof EMPTY_LINE>(k: K, v: (typeof EMPTY_LINE)[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function startEdit(si: SupplierItemRow) {
    setEditingId(si.id);
    setSearch(si.supplier ? `${si.supplier.name}${si.supplier.code ? ` (${si.supplier.code})` : ""}` : "");
    setForm({
      supplier_id: si.supplier?.id ?? "",
      supplier_item_code: si.supplier_item_code ?? "",
      supplier_item_name: si.supplier_item_name ?? "",
      unit_price: si.unit_price != null ? String(si.unit_price) : "",
      currency: si.currency ?? "AUD",
      price_valid_from: si.price_valid_from ?? "",
      price_valid_to: si.price_valid_to ?? "",
      purchase_uom: si.purchase_uom ?? "",
      purchase_uom_qty: si.purchase_uom_qty != null ? String(si.purchase_uom_qty) : "",
      min_order_qty: si.min_order_qty != null ? String(si.min_order_qty) : "",
      lead_time_days: si.lead_time_days != null ? String(si.lead_time_days) : "",
      is_preferred: si.is_preferred,
      notes: si.notes ?? "",
    });
    setShowForm(true);
    setError(null);
  }

  function cancel() {
    setEditingId(null);
    setForm(EMPTY_LINE);
    setSearch("");
    setShowForm(false);
    setError(null);
  }

  async function handleSave() {
    if (!form.supplier_id) { setError("Please select a supplier."); return; }
    setSaving(true);
    setError(null);

    const payload = {
      supplier_id: form.supplier_id,
      item_id: itemId,
      supplier_item_code: form.supplier_item_code || null,
      supplier_item_name: form.supplier_item_name || null,
      unit_price: form.unit_price ? parseFloat(form.unit_price) : null,
      currency: form.currency || "AUD",
      price_valid_from: form.price_valid_from || null,
      price_valid_to: form.price_valid_to || null,
      purchase_uom: form.purchase_uom || null,
      purchase_uom_qty: form.purchase_uom_qty ? parseFloat(form.purchase_uom_qty) : null,
      min_order_qty: form.min_order_qty ? parseFloat(form.min_order_qty) : null,
      lead_time_days: form.lead_time_days ? parseInt(form.lead_time_days) : null,
      is_preferred: form.is_preferred,
      notes: form.notes || null,
    };

    const SELECT = `
      id, supplier_item_code, supplier_item_name,
      unit_price, currency, price_valid_from, price_valid_to,
      purchase_uom, purchase_uom_qty, min_order_qty, lead_time_days,
      is_preferred, notes,
      supplier:supplier_id(id, name, code)
    `;

    let result;
    if (editingId) {
      result = await supabase.from("supplier_items").update(payload).eq("id", editingId).select(SELECT).single();
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();
      result = await supabase.from("supplier_items").insert({ ...payload, tenant_id: profile!.tenant_id }).select(SELECT).single();
    }

    if (result.error) { setError(result.error.message); setSaving(false); return; }

    const saved = result.data as SupplierItemRow;
    setRows(prev => editingId
      ? prev.map(si => si.id === editingId ? saved : si)
      : [...prev, saved]
    );
    cancel();
    setSaving(false);
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    await supabase.from("supplier_items").delete().eq("id", id);
    setRows(prev => prev.filter(si => si.id !== id));
    setDeletingId(null);
  }

  const filteredSuppliers = allSuppliers.filter(s => {
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || (s.code ?? "").toLowerCase().includes(q);
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Suppliers</h2>
        {!showForm && (
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_LINE); setSearch(""); }}
            className="btn-primary"
            style={{ fontSize: "0.8125rem" }}
          >
            + Add Supplier
          </button>
        )}
      </div>

      {rows.length === 0 && !showForm && (
        <p style={{ color: "#78716c", fontSize: "0.875rem", margin: "0 0 1rem" }}>
          No suppliers linked yet. Add a supplier to enable purchase ordering for this item.
        </p>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Supplier Code</th>
                <th>Purchase UOM</th>
                <th>Unit Price</th>
                <th>Lead Time</th>
                <th>Min Order</th>
                <th>Preferred</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(si => {
                const supplierDocs = allSpecDocs.filter(d => d.supplier_id === si.supplier?.id);
                const isExpanded = expandedSupplierId === si.supplier?.id;
                return (
                  <React.Fragment key={si.id}>
                    <tr>
                      <td>
                        {si.supplier ? (
                          <div>
                            <div style={{ fontWeight: 500 }}>
                              <Link href={`/settings/suppliers/${si.supplier.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                                {si.supplier.name}
                              </Link>
                            </div>
                            {si.supplier.code && (
                              <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{si.supplier.code}</div>
                            )}
                          </div>
                        ) : "—"}
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>
                        {si.supplier_item_code ?? "—"}
                      </td>
                      <td style={{ color: "#78716c" }}>
                        {si.purchase_uom
                          ? `${si.purchase_uom}${si.purchase_uom_qty ? ` (${si.purchase_uom_qty} ${itemUnit})` : ""}`
                          : "—"}
                      </td>
                      <td style={{ fontWeight: si.unit_price ? 600 : undefined }}>
                        {si.unit_price != null ? `${si.currency ?? "AUD"} ${si.unit_price.toFixed(2)}` : "—"}
                      </td>
                      <td style={{ color: "#78716c" }}>
                        {si.lead_time_days != null ? `${si.lead_time_days}d` : "—"}
                      </td>
                      <td style={{ color: "#78716c" }}>
                        {si.min_order_qty != null ? `${si.min_order_qty} ${si.purchase_uom ?? itemUnit}` : "—"}
                      </td>
                      <td>
                        {si.is_preferred && (
                          <span className="badge badge-green" style={{ fontSize: "0.6875rem" }}>★ Preferred</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
                          {si.supplier && (
                            <button
                              onClick={() => setExpandedSupplierId(isExpanded ? null : (si.supplier?.id ?? null))}
                              className="btn-secondary"
                              style={{
                                fontSize: "0.75rem", padding: "0.25rem 0.625rem",
                                background: isExpanded ? "#fef2f2" : undefined,
                                borderColor: isExpanded ? "#fca5a5" : undefined,
                                color: isExpanded ? "#b91c1c" : undefined,
                              }}
                            >
                              📄{supplierDocs.length > 0 ? ` (${supplierDocs.length})` : " Specs"}
                            </button>
                          )}
                          <button
                            onClick={() => startEdit(si)}
                            className="btn-secondary"
                            style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(si.id)}
                            disabled={deletingId === si.id}
                            style={{
                              fontSize: "0.75rem", padding: "0.25rem 0.625rem",
                              border: "1px solid #fca5a5", borderRadius: "0.375rem",
                              background: "#fff", color: "#dc2626", cursor: "pointer",
                            }}
                          >
                            {deletingId === si.id ? "…" : "✕"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && si.supplier && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <SupplierSpecsSection
                            supplierId={si.supplier.id}
                            supplierName={si.supplier.name}
                            itemId={itemId}
                            tenantId={tenantId}
                            initialDocs={supplierDocs}
                            onDocsChange={updatedDocs =>
                              setAllSpecDocs(prev => [
                                ...prev.filter(d => d.supplier_id !== si.supplier!.id),
                                ...updatedDocs,
                              ])
                            }
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginTop: rows.length > 0 ? "1rem" : 0 }}>
          <h3 style={{ fontSize: "0.9375rem", fontWeight: "600", margin: "0 0 1rem" }}>
            {editingId ? "Edit Supplier Link" : "Link a Supplier"}
          </h3>

          {/* Supplier search */}
          <div style={{ marginBottom: "1rem", position: "relative" }}>
            <label className="form-label">Supplier *</label>
            <input
              className="form-input"
              value={search}
              onChange={e => { setSearch(e.target.value); setShowDropdown(true); set("supplier_id", ""); }}
              onFocus={() => setShowDropdown(true)}
              placeholder="Search by name or code…"
              autoComplete="off"
            />
            {showDropdown && search && filteredSuppliers.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
                background: "#fff", border: "1px solid #e7e5e4", borderRadius: "0.375rem",
                boxShadow: "0 4px 16px rgba(0,0,0,0.12)", maxHeight: "200px", overflowY: "auto",
              }}>
                {filteredSuppliers.slice(0, 20).map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      set("supplier_id", s.id);
                      setSearch(`${s.name}${s.code ? ` (${s.code})` : ""}`);
                      setShowDropdown(false);
                    }}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "0.5rem 0.75rem", border: "none", background: "none",
                      cursor: "pointer", borderBottom: "1px solid #f5f5f4",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#fef2f2")}
                    onMouseLeave={e => (e.currentTarget.style.background = "none")}
                  >
                    <span style={{ fontWeight: 600, color: "#292524" }}>{s.name}</span>
                    {s.code && <span style={{ color: "#78716c", marginLeft: "0.5rem", fontFamily: "monospace", fontSize: "0.8125rem" }}>{s.code}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label className="form-label">Supplier&apos;s Item Code</label>
              <input className="form-input" value={form.supplier_item_code} onChange={e => set("supplier_item_code", e.target.value)} placeholder="Supplier SKU" style={{ fontFamily: "monospace" }} />
            </div>
            <div>
              <label className="form-label">Supplier&apos;s Item Name</label>
              <input className="form-input" value={form.supplier_item_name} onChange={e => set("supplier_item_name", e.target.value)} placeholder="How supplier describes it" />
            </div>
            <div>
              <label className="form-label">Lead Time (days)</label>
              <CalcInput value={form.lead_time_days} onChange={v => set("lead_time_days", v)} decimals={0} placeholder="e.g. 2" />
            </div>
            <div>
              <label className="form-label">Purchase Unit</label>
              {uoms.length > 0 ? (
                <select
                  className="form-select"
                  value={form.purchase_uom}
                  onChange={e => set("purchase_uom", e.target.value)}
                >
                  <option value="">— Select unit —</option>
                  {/* Preserve a legacy free-text value if the supplier row
                      was saved with a UOM that isn't in the register
                      anymore (e.g. it was deactivated). */}
                  {form.purchase_uom && !uoms.some(u => u.code === form.purchase_uom) && (
                    <option value={form.purchase_uom}>{form.purchase_uom} (legacy)</option>
                  )}
                  {uoms.map(u => (
                    <option key={u.code} value={u.code}>{u.code} — {u.name}</option>
                  ))}
                </select>
              ) : (
                <input className="form-input" value={form.purchase_uom} onChange={e => set("purchase_uom", e.target.value)} placeholder="e.g. bin, carton, bag" />
              )}
            </div>
            <div>
              <label className="form-label">Qty per Purchase Unit ({itemUnit})</label>
              <CalcInput value={form.purchase_uom_qty} onChange={v => set("purchase_uom_qty", v)} decimals={3} placeholder="e.g. 30, or 12*2.5" />
            </div>
            <div>
              <label className="form-label">Min Order Qty</label>
              <CalcInput value={form.min_order_qty} onChange={v => set("min_order_qty", v)} decimals={3} placeholder="e.g. 1" />
            </div>
            <div>
              <label className="form-label">Unit Price</label>
              <CalcInput value={form.unit_price} onChange={v => set("unit_price", v)} decimals={4} placeholder="Per purchase unit — try e.g. 112.50/25" />
            </div>
            <div>
              <label className="form-label">Currency</label>
              <input className="form-input" value={form.currency} onChange={e => set("currency", e.target.value.toUpperCase())} placeholder="AUD" style={{ fontFamily: "monospace" }} />
            </div>
            <div>
              <label className="form-label">Price Valid From</label>
              <input className="form-input" value={form.price_valid_from} onChange={e => set("price_valid_from", e.target.value)} type="date" />
            </div>
            <div>
              <label className="form-label">Price Valid To</label>
              <input className="form-input" value={form.price_valid_to} onChange={e => set("price_valid_to", e.target.value)} type="date" />
            </div>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
              <input type="checkbox" checked={form.is_preferred} onChange={e => set("is_preferred", e.target.checked)} />
              Preferred supplier for this item
            </label>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label className="form-label">Notes</label>
            <input className="form-input" value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Min order notes, special handling, etc." />
          </div>

          {error && (
            <div style={{ marginBottom: "0.75rem", padding: "0.625rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#991b1b", fontSize: "0.875rem" }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ fontSize: "0.875rem" }}>
              {saving ? "Saving…" : editingId ? "Save Changes" : "Link Supplier"}
            </button>
            <button onClick={cancel} className="btn-secondary" style={{ fontSize: "0.875rem" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SupplierSpecsSection ──────────────────────────────────────────────────────

function SupplierSpecsSection({
  supplierId,
  supplierName,
  itemId,
  tenantId,
  initialDocs,
  onDocsChange,
}: {
  supplierId: string;
  supplierName: string;
  itemId: string;
  tenantId: string;
  initialDocs: SpecDoc[];
  onDocsChange: (docs: SpecDoc[]) => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [docs, setDocs] = useState<SpecDoc[]>(initialDocs);
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [docType, setDocType] = useState("supplier_spec");
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const currentDocs = docs.filter(d => !d.expiry_date || new Date(d.expiry_date) >= today);
  const archivedDocs = docs.filter(d => d.expiry_date && new Date(d.expiry_date) < today);

  function updateDocs(next: SpecDoc[]) {
    setDocs(next);
    onDocsChange(next);
  }

  async function upload() {
    if (!file) { setFormError("Please select a file"); return; }
    setUploading(true); setFormError(null);

    const ext = file.name.split(".").pop() ?? "bin";
    const storagePath = `${tenantId}/${itemId}/${Date.now()}.${ext}`;

    const { error: upErr } = await traceyStorage()
      .from("item-specs")
      .upload(storagePath, file, { contentType: file.type || "application/octet-stream", upsert: false });

    if (upErr) { setFormError(upErr.message); setUploading(false); return; }

    const { data: { user } } = await supabase.auth.getUser();

    const { data: doc, error: dbErr } = await supabase.from("item_spec_documents").insert({
      tenant_id: tenantId,
      item_id: itemId,
      supplier_id: supplierId,
      document_type: docType,
      title: title || file.name,
      version: version || null,
      effective_date: effectiveDate || null,
      expiry_date: expiryDate || null,
      document_url: storagePath,
      document_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type || null,
      extraction_status: file.type === "application/pdf" ? "pending" : "skipped",
      uploaded_by: user?.id,
    }).select("*").single();

    if (dbErr) { setFormError(dbErr.message); setUploading(false); return; }

    updateDocs([doc as SpecDoc, ...docs]);
    setFile(null); setTitle(""); setVersion(""); setEffectiveDate(""); setExpiryDate("");
    setShowForm(false); setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  async function archiveDoc(doc: SpecDoc) {
    setArchivingId(doc.id);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const { data: updated } = await supabase.from("item_spec_documents")
      .update({ expiry_date: yesterday.toISOString().slice(0, 10) })
      .eq("id", doc.id)
      .select("*")
      .single();
    updateDocs(docs.map(d => d.id === doc.id ? (updated as SpecDoc ?? doc) : d));
    setArchivingId(null);
  }

  async function deleteDoc(doc: SpecDoc) {
    if (!confirm("Delete this document permanently?")) return;
    await traceyStorage().from("item-specs").remove([doc.document_url]);
    await supabase.from("item_spec_documents").delete().eq("id", doc.id);
    updateDocs(docs.filter(d => d.id !== doc.id));
  }

  async function handleDownload(doc: SpecDoc) {
    const { data } = await traceyStorage().from("item-specs").createSignedUrl(doc.document_url, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  return (
    <div style={{ padding: "0.875rem 1.25rem 1.125rem", background: "#fafaf9", borderTop: "2px solid #e7e5e4" }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#57534e" }}>
          📂 Spec Documents — {supplierName}
        </span>
        <button
          onClick={() => { setShowForm(!showForm); setFormError(null); }}
          className="btn-secondary"
          style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}
        >
          {showForm ? "Cancel" : "+ Add Spec"}
        </button>
      </div>

      {/* Upload form */}
      {showForm && (
        <div style={{ background: "#f5f5f4", borderRadius: "0.5rem", padding: "0.875rem 1rem", marginBottom: "0.875rem", border: "1px solid #e7e5e4" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.625rem", marginBottom: "0.625rem" }}>
            <div>
              <label className="form-label" style={{ fontSize: "0.75rem" }}>Document Type</label>
              <select className="form-input" style={{ fontSize: "0.8125rem" }} value={docType} onChange={e => setDocType(e.target.value)}>
                {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" style={{ fontSize: "0.75rem" }}>Title</label>
              <input className="form-input" style={{ fontSize: "0.8125rem" }} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Pork Shoulder TDS" />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: "0.75rem" }}>Version</label>
              <input className="form-input" style={{ fontSize: "0.8125rem" }} value={version} onChange={e => setVersion(e.target.value)} placeholder="e.g. v2.1" />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: "0.75rem" }}>Effective From</label>
              <input className="form-input" style={{ fontSize: "0.8125rem" }} type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: "0.75rem" }}>Expiry (blank = current)</label>
              <input className="form-input" style={{ fontSize: "0.8125rem" }} type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: "0.75rem" }}>File</label>
              <input
                ref={fileRef}
                type="file"
                style={{ fontSize: "0.8125rem", padding: "0.25rem 0.5rem", border: "1px solid #d6d3d1", borderRadius: "0.375rem", width: "100%", boxSizing: "border-box" as const }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) { setFile(f); if (!title) setTitle(f.name.replace(/\.[^.]+$/, "")); }
                }}
              />
            </div>
          </div>
          {formError && <p style={{ color: "#dc2626", fontSize: "0.8125rem", margin: "0 0 0.5rem" }}>{formError}</p>}
          <button onClick={upload} disabled={uploading} className="btn-primary" style={{ fontSize: "0.8125rem" }}>
            {uploading ? "Uploading…" : "Upload Document"}
          </button>
        </div>
      )}

      {/* Current docs */}
      {currentDocs.length === 0 && !showForm && (
        <p style={{ fontSize: "0.8125rem", color: "#a8a29e", margin: "0 0 0.5rem" }}>
          No spec documents for this supplier. Click &ldquo;+ Add Spec&rdquo; to upload one.
        </p>
      )}
      {currentDocs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", marginBottom: archivedDocs.length > 0 ? "0.625rem" : 0 }}>
          {currentDocs.map(doc => (
            <SpecDocRow
              key={doc.id}
              doc={doc}
              isArchived={false}
              archiving={archivingId === doc.id}
              onArchive={() => archiveDoc(doc)}
              onDelete={() => deleteDoc(doc)}
              onDownload={() => handleDownload(doc)}
            />
          ))}
        </div>
      )}

      {/* Archived docs */}
      {archivedDocs.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchived(!showArchived)}
            style={{ fontSize: "0.75rem", background: "none", border: "none", color: "#a8a29e", cursor: "pointer", padding: "0.25rem 0", display: "flex", alignItems: "center", gap: "0.25rem" }}
          >
            <span style={{ fontSize: "0.6rem" }}>{showArchived ? "▼" : "▶"}</span>
            Archived ({archivedDocs.length})
          </button>
          {showArchived && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", marginTop: "0.375rem" }}>
              {archivedDocs.map(doc => (
                <SpecDocRow
                  key={doc.id}
                  doc={doc}
                  isArchived={true}
                  archiving={false}
                  onArchive={() => {}}
                  onDelete={() => deleteDoc(doc)}
                  onDownload={() => handleDownload(doc)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── SpecDocRow ────────────────────────────────────────────────────────────────

function SpecDocRow({
  doc,
  isArchived,
  archiving,
  onArchive,
  onDelete,
  onDownload,
}: {
  doc: SpecDoc;
  isArchived: boolean;
  archiving: boolean;
  onArchive: () => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  const icon = fileIcon(doc.mime_type, doc.document_name);
  const expiryDate = doc.expiry_date ? new Date(doc.expiry_date) : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const expiringSoon = !isArchived && expiryDate != null &&
    expiryDate >= today &&
    (expiryDate.getTime() - today.getTime()) / 86400000 <= 60;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "0.625rem",
      padding: "0.5rem 0.75rem", borderRadius: "0.375rem",
      background: isArchived ? "#f5f5f4" : expiringSoon ? "#fefce8" : "#fff",
      border: `1px solid ${expiringSoon ? "#fde047" : "#e7e5e4"}`,
      opacity: isArchived ? 0.75 : 1,
    }}>
      <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{doc.title}</span>
          {doc.version && (
            <span style={{ fontSize: "0.6875rem", background: "#f0f0f0", padding: "0.1rem 0.35rem", borderRadius: "0.25rem", color: "#78716c" }}>
              {doc.version}
            </span>
          )}
          <span style={{ fontSize: "0.6875rem", background: "#f0f0f0", padding: "0.1rem 0.35rem", borderRadius: "0.25rem", color: "#57534e" }}>
            {DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}
          </span>
          {expiringSoon && <span className="badge badge-yellow" style={{ fontSize: "0.6875rem" }}>Expiring soon</span>}
          {isArchived && <span style={{ fontSize: "0.6875rem", background: "#f5f5f4", padding: "0.1rem 0.35rem", borderRadius: "0.25rem", color: "#a8a29e" }}>Archived</span>}
        </div>
        <div style={{ fontSize: "0.75rem", color: "#a8a29e", marginTop: "0.125rem" }}>
          {doc.effective_date && <span>From {new Date(doc.effective_date).toLocaleDateString("en-AU")} · </span>}
          {doc.expiry_date && <span>To {new Date(doc.expiry_date).toLocaleDateString("en-AU")} · </span>}
          <span>{doc.document_name}</span>
          {doc.file_size_bytes ? <span> ({formatBytes(doc.file_size_bytes)})</span> : null}
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.375rem", flexShrink: 0, alignItems: "center" }}>
        <button onClick={onDownload} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }} title="Download">
          ↓
        </button>
        {!isArchived && (
          <button onClick={onArchive} disabled={archiving} className="btn-secondary"
            style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", color: "#92400e", borderColor: "#fcd34d" }}>
            {archiving ? "…" : "Archive"}
          </button>
        )}
        <button onClick={onDelete}
          style={{ fontSize: "0.75rem", background: "none", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#dc2626", cursor: "pointer", padding: "0.2rem 0.5rem" }}>
          ✕
        </button>
      </div>
    </div>
  );
}
