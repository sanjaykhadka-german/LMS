"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { traceyStorage } from "@/lib/storage/client";

type Cert = {
  id: string;
  certification_type: string;
  certificate_number: string | null;
  issued_by: string | null;
  issued_date: string | null;
  expiry_date: string | null;
  document_url: string | null;
  document_name: string | null;
  status: string;
  notes: string | null;
};

const COMMON_CERT_TYPES = [
  "HACCP", "SQF", "BRC / BRCGS", "ISO 22000", "FSSC 22000",
  "Halal", "Kosher", "Organic", "WQA", "AQIS / DAFF",
  "Safe Food Queensland", "Freshcare", "Other",
];

function daysUntilExpiry(expiryDate: string | null): number | null {
  if (!expiryDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.floor((new Date(expiryDate).getTime() - today.getTime()) / 86400000);
}

function ExpiryBadge({ expiryDate, status }: { expiryDate: string | null; status: string }) {
  if (status === "expired")   return <span className="badge badge-red"   style={{ fontSize: "0.6875rem" }}>Expired</span>;
  if (status === "suspended") return <span className="badge badge-yellow" style={{ fontSize: "0.6875rem" }}>Suspended</span>;
  if (status === "pending")   return <span className="badge badge-gray"   style={{ fontSize: "0.6875rem" }}>Pending</span>;
  if (!expiryDate)            return <span className="badge badge-green"  style={{ fontSize: "0.6875rem" }}>No Expiry</span>;
  const days = daysUntilExpiry(expiryDate);
  if (days === null) return null;
  if (days < 0)   return <span className="badge badge-red"  style={{ fontSize: "0.6875rem" }}>Expired {Math.abs(days)}d ago</span>;
  if (days <= 30) return <span className="badge badge-red"  style={{ fontSize: "0.6875rem" }}>⚠ Expires in {days}d</span>;
  if (days <= 60) return <span style={{ display:"inline-flex",alignItems:"center",gap:"0.25rem",background:"#fff7ed",color:"#c2410c",border:"1px solid #fed7aa",borderRadius:"0.375rem",padding:"0.125rem 0.5rem",fontSize:"0.6875rem",fontWeight:600 }}>⚠ Expires in {days}d</span>;
  if (days <= 90) return <span style={{ display:"inline-flex",alignItems:"center",gap:"0.25rem",background:"#fefce8",color:"#a16207",border:"1px solid #fde68a",borderRadius:"0.375rem",padding:"0.125rem 0.5rem",fontSize:"0.6875rem",fontWeight:600 }}>Expires in {days}d</span>;
  return <span className="badge badge-green" style={{ fontSize: "0.6875rem" }}>Active</span>;
}

const BLANK: Omit<Cert, "id"> = {
  certification_type: "", certificate_number: "", issued_by: "",
  issued_date: "", expiry_date: "", document_url: null, document_name: null,
  status: "active", notes: "",
};

export default function SupplierCertificationsPanel({
  supplierId, tenantId, initialCerts, supplierName,
}: {
  supplierId: string;
  tenantId: string;
  initialCerts: Cert[];
  supplierName?: string;
}) {
  const supabase = createClient();
  const [certs, setCerts] = useState<Cert[]>(initialCerts);
  const [editing, setEditing] = useState<Cert | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractNotice, setExtractNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const expiringCount = certs.filter(c => {
    const days = daysUntilExpiry(c.expiry_date);
    return c.status === "active" && days !== null && days <= 90;
  }).length;

  function openNew()         { setEditing({ id: "", ...BLANK }); setIsNew(true);  setError(null); setExtractNotice(null); }
  function openEdit(c: Cert) { setEditing({ ...c });             setIsNew(false); setError(null); setExtractNotice(null); }
  function closeForm()       { setEditing(null); setIsNew(false); setError(null); setExtractNotice(null); }
  function setField<K extends keyof Cert>(k: K, v: Cert[K]) {
    setEditing(f => f ? { ...f, [k]: v } : f);
  }

  async function uploadFile(file: File) {
    if (!editing) return;
    setUploading(true); setError(null); setExtractNotice(null);

    const ext = file.name.split(".").pop();
    const path = `${tenantId}/${supplierId}/${Date.now()}.${ext}`;
    const { error: upErr } = await traceyStorage()
      .from("supplier-certs")
      .upload(path, file, { upsert: false });

    if (upErr) { setError(upErr.message); setUploading(false); return; }

    setField("document_url", path);
    setField("document_name", file.name);
    setUploading(false);

    // Auto-extract from PDF
    if (file.type === "application/pdf") {
      setExtracting(true);
      setExtractNotice("✦ Reading certificate with AI…");
      try {
        const res = await fetch("/api/extract-cert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storagePath: path, supplierName: supplierName ?? "" }),
        });
        const data = await res.json();
        if (res.ok && data.extracted) {
          const e = data.extracted as Record<string, string>;
          const filled: string[] = [];

          setEditing(prev => {
            if (!prev) return prev;
            const updated = { ...prev };

            // Only pre-fill fields the user hasn't already typed in
            if (!prev.certification_type && e.certification_type) {
              updated.certification_type = e.certification_type; filled.push("type");
            }
            if (!prev.certificate_number && e.certificate_number) {
              updated.certificate_number = e.certificate_number; filled.push("number");
            }
            if (!prev.issued_by && e.issued_by) {
              updated.issued_by = e.issued_by; filled.push("issuer");
            }
            if (!prev.issued_date && e.issued_date) {
              updated.issued_date = e.issued_date; filled.push("issued date");
            }
            if (!prev.expiry_date && e.expiry_date) {
              updated.expiry_date = e.expiry_date; filled.push("expiry date");
            }
            if (!prev.notes && e.notes) {
              updated.notes = e.notes;
            }
            return updated;
          });

          setExtractNotice(
            filled.length > 0
              ? `✦ AI filled in: ${filled.join(", ")} — please verify before saving`
              : "✦ AI read the document but couldn't identify cert details — fill in manually"
          );
        } else {
          setExtractNotice("Could not extract details — fill in manually");
        }
      } catch {
        setExtractNotice("AI extraction failed — fill in manually");
      }
      setExtracting(false);
    }
  }

  async function openSignedUrl(path: string) {
    const { data } = await traceyStorage().from("supplier-certs").createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  function handleDragOver(e: React.DragEvent)  { e.preventDefault(); setIsDragging(true); }
  function handleDragLeave(e: React.DragEvent) { e.preventDefault(); setIsDragging(false); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) uploadFile(f);
  }

  async function handleSave() {
    if (!editing) return;
    if (!editing.certification_type.trim()) { setError("Certification type is required."); return; }
    setSaving(true); setError(null);

    const payload = {
      tenant_id: tenantId, supplier_id: supplierId,
      certification_type: editing.certification_type.trim(),
      certificate_number: editing.certificate_number || null,
      issued_by: editing.issued_by || null,
      issued_date: editing.issued_date || null,
      expiry_date: editing.expiry_date || null,
      document_url: editing.document_url || null,
      document_name: editing.document_name || null,
      status: editing.status,
      notes: editing.notes || null,
    };

    if (isNew) {
      const { data, error: err } = await supabase.from("supplier_certifications").insert(payload).select().single();
      if (err) { setError(err.message); setSaving(false); return; }
      setCerts(prev => [...prev, data]);
    } else {
      const { data, error: err } = await supabase.from("supplier_certifications").update(payload).eq("id", editing.id).select().single();
      if (err) { setError(err.message); setSaving(false); return; }
      setCerts(prev => prev.map(c => c.id === data.id ? data : c));
    }
    setSaving(false); closeForm();
  }

  async function handleDelete(certId: string) {
    if (!confirm("Delete this certification?")) return;
    setDeleting(certId);
    await supabase.from("supplier_certifications").delete().eq("id", certId);
    setCerts(prev => prev.filter(c => c.id !== certId));
    setDeleting(null);
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      {/* Header */}
      <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Certifications</h2>
          {expiringCount > 0 && <span className="badge badge-red" style={{ fontSize: "0.6875rem" }}>⚠ {expiringCount} expiring soon</span>}
        </div>
        <button className="btn-primary" style={{ fontSize: "0.8125rem" }} onClick={openNew}>+ Add Certification</button>
      </div>

      {/* Expiry alert */}
      {expiringCount > 0 && !editing && (
        <div style={{ margin: "0.75rem 1.25rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", padding: "0.75rem 1rem", fontSize: "0.875rem", color: "#991b1b" }}>
          <strong>Action required:</strong> {expiringCount} certification{expiringCount > 1 ? "s" : ""} expiring within 90 days.
        </div>
      )}

      {/* Form */}
      {editing && (
        <div style={{ padding: "1.25rem", borderBottom: "1px solid #e7e5e4", background: "#fafaf9" }}>
          <h3 style={{ fontSize: "0.9375rem", fontWeight: "600", margin: "0 0 1rem" }}>
            {isNew ? "Add Certification" : "Edit Certification"}
          </h3>

          {/* AI extract notice */}
          {extractNotice && (
            <div style={{
              marginBottom: "0.875rem", padding: "0.625rem 0.875rem", borderRadius: "0.375rem",
              background: extracting ? "#eff6ff" : extractNotice.startsWith("✦") ? "#f0fdf4" : "#fef2f2",
              border: `1px solid ${extracting ? "#bfdbfe" : extractNotice.startsWith("✦") ? "#bbf7d0" : "#fca5a5"}`,
              color: extracting ? "#1d4ed8" : extractNotice.startsWith("✦") ? "#15803d" : "#dc2626",
              fontSize: "0.8125rem",
            }}>
              {extracting ? "⟳ Reading certificate with AI…" : extractNotice}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            {/* Document upload — first so AI can pre-fill below */}
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Certificate Document <span style={{ color: "#1d4ed8", fontWeight: 400 }}>(upload PDF first — AI will pre-fill the fields below)</span></label>
              <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
                style={{ display: "none" }}
                onChange={e => { if (e.target.files?.[0]) uploadFile(e.target.files[0]); }} />
              {editing.document_name ? (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.625rem 0.875rem", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "0.5rem" }}>
                  <button type="button" onClick={() => editing.document_url && openSignedUrl(editing.document_url)}
                    style={{ background: "none", border: "none", color: "#15803d", cursor: "pointer", fontSize: "0.875rem", padding: 0, fontWeight: 500 }}>
                    📄 {editing.document_name}
                  </button>
                  <button type="button" onClick={() => { setField("document_url", null); setField("document_name", null); setExtractNotice(null); }}
                    style={{ background: "none", border: "none", color: "#a8a29e", cursor: "pointer", fontSize: "0.75rem", marginLeft: "auto" }}>
                    Remove
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={handleDragOver} onDragEnter={handleDragOver}
                  onDragLeave={handleDragLeave} onDrop={handleDrop}
                  style={{
                    border: `2px dashed ${isDragging ? "#b91c1c" : "#d6d3d1"}`,
                    borderRadius: "0.5rem", padding: "1rem", textAlign: "center",
                    cursor: "pointer", background: isDragging ? "#fff1f2" : "#fff",
                    transition: "all 0.15s ease", userSelect: "none",
                  }}>
                  <div style={{ fontSize: "0.875rem", color: isDragging ? "#b91c1c" : "#78716c" }}>
                    {uploading ? "Uploading…" : isDragging ? "Drop it here" : (
                      <>☁ Drop PDF or <span style={{ color: "#b91c1c", textDecoration: "underline" }}>browse</span> — AI will read it and fill the fields below</>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Cert type */}
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Certification Type *</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <select className="form-select"
                  value={COMMON_CERT_TYPES.includes(editing.certification_type) ? editing.certification_type : editing.certification_type ? "Other" : ""}
                  onChange={e => { if (e.target.value !== "Other") setField("certification_type", e.target.value); else setField("certification_type", ""); }}
                  style={{ width: "220px", flexShrink: 0 }}>
                  <option value="">— Select type —</option>
                  {COMMON_CERT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input className="form-input" value={editing.certification_type}
                  onChange={e => setField("certification_type", e.target.value)}
                  placeholder="or type a custom certification name" style={{ flex: 1 }} />
              </div>
            </div>

            <div>
              <label className="form-label">Certificate / Licence Number</label>
              <input className="form-input" value={editing.certificate_number ?? ""}
                onChange={e => setField("certificate_number", e.target.value)} placeholder="e.g. HACCP-2024-001234" />
            </div>
            <div>
              <label className="form-label">Issued By</label>
              <input className="form-input" value={editing.issued_by ?? ""}
                onChange={e => setField("issued_by", e.target.value)} placeholder="e.g. DAFF, SAI Global" />
            </div>
            <div>
              <label className="form-label">Issued Date</label>
              <input className="form-input" type="date" value={editing.issued_date ?? ""} onChange={e => setField("issued_date", e.target.value)} />
            </div>
            <div>
              <label className="form-label">Expiry Date</label>
              <input className="form-input" type="date" value={editing.expiry_date ?? ""} onChange={e => setField("expiry_date", e.target.value)} />
            </div>
            <div>
              <label className="form-label">Status</label>
              <select className="form-select" value={editing.status} onChange={e => setField("status", e.target.value)}>
                <option value="active">Active</option>
                <option value="pending">Pending (awaiting issue)</option>
                <option value="suspended">Suspended</option>
                <option value="expired">Expired</option>
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Notes</label>
              <textarea className="form-input" value={editing.notes ?? ""} onChange={e => setField("notes", e.target.value)}
                rows={2} style={{ resize: "vertical" }}
                placeholder="Scope of certification, conditions, renewal contacts, etc." />
            </div>
          </div>

          {error && (
            <div style={{ marginTop: "0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.375rem", padding: "0.5rem 0.75rem", color: "#991b1b", fontSize: "0.875rem" }}>
              {error}
            </div>
          )}
          <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem" }}>
            <button className="btn-primary" onClick={handleSave} disabled={saving || uploading || extracting}>
              {saving ? "Saving…" : isNew ? "Add Certification" : "Save Changes"}
            </button>
            <button className="btn-secondary" onClick={closeForm}>Cancel</button>
          </div>
        </div>
      )}

      {/* List */}
      {certs.length === 0 && !editing ? (
        <div style={{ padding: "2.5rem", textAlign: "center", color: "#78716c" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📋</div>
          <p style={{ margin: 0, fontSize: "0.9375rem" }}>No certifications on file.</p>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "#a8a29e" }}>
            Add HACCP, Halal, SQF and other certificates to track their expiry.
          </p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Certification</th><th>Cert Number</th><th>Issued By</th><th>Issued</th><th>Expiry</th><th>Status</th><th>Document</th><th></th></tr>
          </thead>
          <tbody>
            {[...certs].sort((a, b) => (daysUntilExpiry(a.expiry_date) ?? 9999) - (daysUntilExpiry(b.expiry_date) ?? 9999)).map(cert => {
              const days = daysUntilExpiry(cert.expiry_date);
              return (
                <tr key={cert.id} style={{
                  background: days !== null && days <= 30 && cert.status === "active" ? "#fef2f2"
                            : days !== null && days <= 60 && cert.status === "active" ? "#fff7ed" : undefined
                }}>
                  <td style={{ fontWeight: 600 }}>{cert.certification_type}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{cert.certificate_number ?? "—"}</td>
                  <td style={{ color: "#78716c" }}>{cert.issued_by ?? "—"}</td>
                  <td style={{ color: "#78716c" }}>{cert.issued_date ? new Date(cert.issued_date).toLocaleDateString("en-AU", { day:"numeric", month:"short", year:"numeric" }) : "—"}</td>
                  <td>{cert.expiry_date ? new Date(cert.expiry_date).toLocaleDateString("en-AU", { day:"numeric", month:"short", year:"numeric" }) : <span style={{ color: "#a8a29e" }}>No expiry</span>}</td>
                  <td><ExpiryBadge expiryDate={cert.expiry_date} status={cert.status} /></td>
                  <td>
                    {cert.document_name && cert.document_url
                      ? <button onClick={() => openSignedUrl(cert.document_url!)}
                          style={{ background:"none", border:"none", color:"#b91c1c", cursor:"pointer", fontSize:"0.8125rem", padding:0 }}>
                          📄 {cert.document_name.length > 22 ? cert.document_name.slice(0, 22) + "…" : cert.document_name}
                        </button>
                      : <span style={{ color: "#a8a29e", fontSize: "0.8125rem" }}>—</span>}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button className="btn-secondary" style={{ fontSize:"0.75rem", padding:"0.25rem 0.625rem" }} onClick={() => openEdit(cert)}>Edit</button>
                      <button style={{ fontSize:"0.75rem", padding:"0.25rem 0.625rem", background:"none", border:"1px solid #fca5a5", borderRadius:"0.375rem", color:"#dc2626", cursor:"pointer" }}
                        onClick={() => handleDelete(cert.id)} disabled={deleting === cert.id}>
                        {deleting === cert.id ? "…" : "Delete"}
                      </button>
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
