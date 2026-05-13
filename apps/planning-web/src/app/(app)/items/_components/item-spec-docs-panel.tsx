"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
  extraction_status: string | null;
  extracted_data: Record<string, unknown> | null;
  created_at: string;
  supplier?: { id: string; name: string } | null;
};

type Supplier = { id: string; name: string };

const DOC_TYPE_LABELS: Record<string, string> = {
  spec_sheet:    "Spec Sheet (TDS)",
  coa:           "Certificate of Analysis",
  sds:           "Safety Data Sheet",
  allergen_decl: "Allergen Declaration",
  nutritional:   "Nutritional Analysis",
  micro_report:  "Micro Report",
  supplier_spec: "Supplier Specification",
  other:         "Other",
};

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  done:       { bg: "#f0fdf4", color: "#15803d" },
  processing: { bg: "#eff6ff", color: "#1d4ed8" },
  pending:    { bg: "#fefce8", color: "#b45309" },
  failed:     { bg: "#fef2f2", color: "#dc2626" },
  skipped:    { bg: "#f5f5f4", color: "#78716c" },
};

function formatBytes(b: number | null) {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function isImage(mime: string | null) {
  return mime?.startsWith("image/") ?? false;
}

function fileIcon(mime: string | null, name: string) {
  if (!mime) return "📄";
  if (mime.startsWith("image/")) return "🖼";
  if (mime === "application/pdf") return "📕";
  if (mime.includes("word") || name.endsWith(".docx") || name.endsWith(".doc")) return "📝";
  if (mime.includes("excel") || mime.includes("spreadsheet") || name.endsWith(".xlsx") || name.endsWith(".xls")) return "📊";
  return "📄";
}

export default function ItemSpecDocsPanel({
  itemId, tenantId, docs, suppliers, itemType,
}: {
  itemId: string;
  tenantId: string;
  docs: SpecDoc[];
  suppliers: Supplier[];
  itemType: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedExtraction, setExpandedExtraction] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  // Preview modal
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewMime, setPreviewMime] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Form state
  const [docType, setDocType] = useState("spec_sheet");
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [file, setFile] = useState<File | null>(null);

  // Split docs: current vs archived
  const today = new Date(); today.setHours(0,0,0,0);
  const currentDocs = docs.filter(d => !d.expiry_date || new Date(d.expiry_date) >= today);
  const archivedDocs = docs.filter(d => d.expiry_date && new Date(d.expiry_date) < today);

  const expiringSoon = currentDocs.filter(d => {
    if (!d.expiry_date) return false;
    const diff = (new Date(d.expiry_date).getTime() - Date.now()) / 86400000;
    return diff <= 60;
  });

  function applyFile(f: File) {
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (f) applyFile(f);
  }

  function handleDragOver(e: React.DragEvent) { e.preventDefault(); setIsDragging(true); }
  function handleDragLeave(e: React.DragEvent) { e.preventDefault(); setIsDragging(false); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) applyFile(f);
  }

  async function upload() {
    if (!file) { setError("Please select a file"); return; }
    setUploading(true); setError(null);

    const ext = file.name.split(".").pop() ?? "bin";
    const storagePath = `${tenantId}/${itemId}/${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("item-specs")
      .upload(storagePath, file, { contentType: file.type || "application/octet-stream", upsert: false });

    if (upErr) { setError(upErr.message); setUploading(false); return; }

    const { data: { user } } = await supabase.auth.getUser();

    const { data: doc, error: dbErr } = await supabase.from("item_spec_documents").insert({
      tenant_id: tenantId,
      item_id: itemId,
      document_type: docType,
      title: title || file.name,
      version: version || null,
      effective_date: effectiveDate || null,
      expiry_date: expiryDate || null,
      supplier_id: supplierId || null,
      document_url: storagePath,
      document_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type || null,
      extraction_status: file.type === "application/pdf" ? "pending" : "skipped",
      uploaded_by: user?.id,
    }).select("id").single();

    if (dbErr) { setError(dbErr.message); setUploading(false); return; }

    if (file.type === "application/pdf" && doc) triggerExtraction(doc.id, storagePath);

    setFile(null); setTitle(""); setVersion(""); setEffectiveDate("");
    setExpiryDate(""); setSupplierId(""); setShowAdd(false);
    setUploading(false);
    router.refresh();
  }

  async function archiveDoc(doc: SpecDoc) {
    setArchivingId(doc.id);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    await supabase.from("item_spec_documents")
      .update({ expiry_date: yesterday.toISOString().slice(0, 10) })
      .eq("id", doc.id);
    setArchivingId(null);
    router.refresh();
  }

  async function deleteDoc(doc: SpecDoc) {
    if (!confirm("Delete this document permanently?")) return;
    await supabase.storage.from("item-specs").remove([doc.document_url]);
    await supabase.from("item_spec_documents").delete().eq("id", doc.id);
    router.refresh();
  }

  async function triggerExtraction(docId: string, storagePath: string) {
    setExtracting(docId);
    try {
      await fetch("/api/extract-spec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, storagePath, itemId }),
      });
    } catch { /* errors logged server-side */ }
    setExtracting(null);
    router.refresh();
  }

  async function getSignedUrl(storagePath: string, seconds = 120) {
    const { data } = await supabase.storage.from("item-specs").createSignedUrl(storagePath, seconds);
    return data?.signedUrl ?? null;
  }

  async function openPreview(doc: SpecDoc) {
    setPreviewLoading(true);
    setPreviewTitle(doc.title);
    setPreviewMime(doc.mime_type);
    const url = await getSignedUrl(doc.document_url, 600);
    setPreviewUrl(url);
    setPreviewLoading(false);
  }

  async function handleDownload(doc: SpecDoc) {
    const url = await getSignedUrl(doc.document_url, 120);
    if (url) window.open(url, "_blank");
  }

  const isRawMaterial = itemType === "raw_material" || itemType === "packaging";

  function DocRow({ doc, isArchived }: { doc: SpecDoc; isArchived: boolean }) {
    const isExpiringSoon = expiringSoon.some(d => d.id === doc.id);
    const statusStyle = STATUS_COLORS[doc.extraction_status ?? "skipped"] ?? STATUS_COLORS.skipped;
    const canPreview = doc.mime_type === "application/pdf" || isImage(doc.mime_type);
    const icon = fileIcon(doc.mime_type, doc.document_name);

    return (
      <div style={{
        border: `1px solid ${isExpiringSoon ? "#fde047" : "#e7e5e4"}`,
        borderRadius: "0.5rem", padding: "0.75rem 1rem",
        background: isArchived ? "#fafaf9" : isExpiringSoon ? "#fefce8" : "#fff",
        opacity: isArchived ? 0.8 : 1,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "1.1rem" }}>{icon}</span>
              <span style={{ fontWeight: 600, fontSize: "0.9375rem" }}>{doc.title}</span>
              {doc.version && (
                <span style={{ fontSize: "0.75rem", color: "#78716c", background: "#f5f5f4",
                  padding: "0.125rem 0.375rem", borderRadius: "0.25rem" }}>
                  {doc.version}
                </span>
              )}
              <span style={{ fontSize: "0.6875rem", fontWeight: 600, padding: "0.125rem 0.5rem",
                borderRadius: "0.25rem", background: "#f0f0f0", color: "#57534e" }}>
                {DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}
              </span>
              {!isArchived && isExpiringSoon && (
                <span className="badge badge-yellow" style={{ fontSize: "0.6875rem" }}>Expiring soon</span>
              )}
              {isArchived && (
                <span style={{ fontSize: "0.6875rem", padding: "0.125rem 0.375rem", borderRadius: "0.25rem",
                  background: "#f5f5f4", color: "#a8a29e" }}>Archived</span>
              )}
            </div>
            <div style={{ fontSize: "0.8125rem", color: "#78716c", marginTop: "0.25rem" }}>
              {doc.supplier?.name && <span>{doc.supplier.name} · </span>}
              {doc.effective_date && <span>From: {new Date(doc.effective_date).toLocaleDateString("en-AU")} · </span>}
              {doc.expiry_date && <span>To: {new Date(doc.expiry_date).toLocaleDateString("en-AU")} · </span>}
              <span>{doc.document_name}</span>
              {doc.file_size_bytes && <span> ({formatBytes(doc.file_size_bytes)})</span>}
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {doc.extraction_status && doc.extraction_status !== "skipped" && (
              <span style={{ fontSize: "0.6875rem", fontWeight: 600, padding: "0.125rem 0.5rem",
                borderRadius: "0.25rem", background: statusStyle.bg, color: statusStyle.color }}>
                {doc.extraction_status === "done" ? "AI extracted" :
                 doc.extraction_status === "processing" ? "Extracting..." :
                 doc.extraction_status === "pending" ? "Pending" : "Failed"}
              </span>
            )}
            {doc.extraction_status === "done" && doc.extracted_data && (
              <button onClick={() => setExpandedExtraction(expandedExtraction === doc.id ? null : doc.id)}
                className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}>
                {expandedExtraction === doc.id ? "Hide data" : "AI data"}
              </button>
            )}
            {(doc.extraction_status === "failed" || doc.extraction_status === "pending") && (
              <button onClick={() => triggerExtraction(doc.id, doc.document_url)}
                className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}>
                Retry AI
              </button>
            )}
            {canPreview && (
              <button onClick={() => openPreview(doc)} className="btn-secondary"
                style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}>
                Preview
              </button>
            )}
            <button onClick={() => handleDownload(doc)} className="btn-secondary"
              style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}>
              Download
            </button>
            {!isArchived && (
              <button onClick={() => archiveDoc(doc)} disabled={archivingId === doc.id}
                className="btn-secondary"
                style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", color: "#92400e", borderColor: "#fcd34d" }}>
                {archivingId === doc.id ? "..." : "Archive"}
              </button>
            )}
            <button onClick={() => deleteDoc(doc)}
              style={{ fontSize: "0.75rem", background: "none", border: "1px solid #fca5a5",
                borderRadius: "0.5rem", color: "#dc2626", cursor: "pointer", padding: "0.2rem 0.5rem" }}>
              Delete
            </button>
          </div>
        </div>

        {expandedExtraction === doc.id && doc.extracted_data && (
          <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid #e7e5e4" }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "#78716c", margin: "0 0 0.5rem",
              textTransform: "uppercase", letterSpacing: "0.05em" }}>AI-Extracted Values</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem" }}>
              {Object.entries(doc.extracted_data as Record<string, string>)
                .filter(([, v]) => v && v !== "not found" && v !== "N/A")
                .map(([k, v]) => (
                  <div key={k} style={{ background: "#f0fdf4", borderRadius: "0.375rem",
                    padding: "0.375rem 0.625rem", fontSize: "0.8125rem" }}>
                    <div style={{ fontSize: "0.7rem", color: "#78716c", textTransform: "capitalize" }}>
                      {k.replace(/_/g, " ")}
                    </div>
                    <div style={{ fontWeight: 600, color: "#166534", marginTop: "0.125rem" }}>{String(v)}</div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Preview modal */}
      {(previewUrl || previewLoading) && (
        <div
          // No backdrop close — use × in the header to dismiss.
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.7)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
          <div
            style={{ background: "#fff", borderRadius: "0.75rem", width: "100%", maxWidth: "900px",
              height: "85vh", display: "flex", flexDirection: "column", overflow: "hidden",
              boxShadow: "0 25px 60px rgba(0,0,0,0.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4", flexShrink: 0 }}>
              <span style={{ fontWeight: 600, fontSize: "0.9375rem" }}>{previewTitle}</span>
              <button onClick={() => setPreviewUrl(null)}
                style={{ background: "none", border: "1px solid #e7e5e4", borderRadius: "0.375rem",
                  cursor: "pointer", padding: "0.25rem 0.625rem", fontSize: "0.875rem", color: "#57534e" }}>
                Close
              </button>
            </div>
            <div style={{ flex: 1, overflow: "hidden", background: "#f5f5f4" }}>
              {previewLoading ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#78716c" }}>
                  Loading...
                </div>
              ) : previewUrl && isImage(previewMime) ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: "1rem" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt={previewTitle} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: "0.5rem" }} />
                </div>
              ) : previewUrl ? (
                <iframe src={previewUrl} style={{ width: "100%", height: "100%", border: "none" }} title={previewTitle} />
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Specification Documents</h2>
          <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0.25rem 0 0" }}>
            {isRawMaterial
              ? "TDS, CoA, allergen declarations, SDS and other supplier documents"
              : "Product specs, nutritional analysis and compliance documents"}
          </p>
        </div>
        <button onClick={() => setShowAdd(s => !s)} className="btn-secondary" style={{ fontSize: "0.875rem" }}>
          {showAdd ? "Cancel" : "+ Add Document"}
        </button>
      </div>

      {expiringSoon.length > 0 && (
        <div style={{ marginBottom: "0.75rem", padding: "0.625rem 0.875rem", background: "#fefce8",
          border: "1px solid #fde047", borderRadius: "0.5rem", fontSize: "0.8125rem", color: "#854d0e" }}>
          {expiringSoon.length} document{expiringSoon.length > 1 ? "s" : ""} expiring within 60 days:{" "}
          {expiringSoon.map(d => d.title).join(", ")}
        </div>
      )}

      {/* Upload form */}
      {showAdd && (
        <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem",
          padding: "1rem", marginBottom: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <div>
              <label className="form-label">Document Type</label>
              <select className="form-select" value={docType} onChange={e => setDocType(e.target.value)}>
                {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label className="form-label">Title</label>
              <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Pork Belly TDS v3" />
            </div>
            <div>
              <label className="form-label">Version</label>
              <input className="form-input" value={version} onChange={e => setVersion(e.target.value)} placeholder="e.g. v3 or Jan 2025" />
            </div>
            <div>
              <label className="form-label">Effective From</label>
              <input className="form-input" type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Expiry Date (leave blank = current)</label>
              <input className="form-input" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Supplier (if applicable)</label>
              <select className="form-select" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">None (general item spec)</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label className="form-label">File (PDF, Word, Excel, JPG, PNG, or any format)</label>
              <input ref={fileRef} type="file" onChange={handleFileChange} style={{ display: "none" }} />
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={handleDragOver} onDragEnter={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                style={{
                  border: `2px dashed ${isDragging ? "#b91c1c" : file ? "#16a34a" : "#d6d3d1"}`,
                  borderRadius: "0.5rem", padding: "1.25rem", textAlign: "center", cursor: "pointer",
                  background: isDragging ? "#fff1f2" : file ? "#f0fdf4" : "#fff", transition: "all 0.15s ease",
                }}>
                {file ? (
                  <div>
                    <div style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>{fileIcon(file.type, file.name)}</div>
                    <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "#15803d" }}>{file.name}</div>
                    <div style={{ fontSize: "0.8125rem", color: "#78716c" }}>{formatBytes(file.size)}</div>
                    {file.type === "application/pdf" && (
                      <div style={{ fontSize: "0.8125rem", color: "#1d4ed8", marginTop: "0.25rem" }}>AI will extract spec values after upload</div>
                    )}
                    <div style={{ fontSize: "0.75rem", color: "#a8a29e", marginTop: "0.25rem" }}>Click or drop to replace</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: "1.75rem", marginBottom: "0.375rem", color: isDragging ? "#b91c1c" : "#a8a29e" }}>
                      {isDragging ? "Drop it" : "Upload"}
                    </div>
                    <div style={{ fontWeight: 500, fontSize: "0.875rem", color: isDragging ? "#b91c1c" : "#57534e" }}>
                      {isDragging ? "Drop it here" : "Drag & drop or click to browse"}
                    </div>
                    <div style={{ fontSize: "0.8125rem", color: "#a8a29e", marginTop: "0.25rem" }}>Any file type accepted</div>
                  </div>
                )}
              </div>
            </div>
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: "0.875rem", margin: "0 0 0.5rem" }}>{error}</p>}
          <button onClick={upload} className="btn-primary" disabled={uploading || !file}>
            {uploading ? "Uploading..." : "Upload Document"}
          </button>
        </div>
      )}

      {/* Current Documents */}
      {currentDocs.length === 0 && archivedDocs.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#78716c", textAlign: "center", padding: "1.5rem 0" }}>
          No documents uploaded yet.{isRawMaterial && " Upload a TDS or CoA from your supplier."}
        </p>
      ) : (
        <>
          {currentDocs.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase",
                letterSpacing: "0.05em", margin: "0 0 0.5rem" }}>
                Current ({currentDocs.length})
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
                {currentDocs.map(doc => <DocRow key={doc.id} doc={doc} isArchived={false} />)}
              </div>
            </div>
          )}

          {/* Archive section */}
          {archivedDocs.length > 0 && (
            <div>
              <button
                onClick={() => setShowArchived(s => !s)}
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "none", border: "none",
                  cursor: "pointer", padding: "0.375rem 0", fontSize: "0.8125rem", color: "#78716c", fontWeight: 600 }}>
                <span style={{ transform: showArchived ? "rotate(90deg)" : "none", display: "inline-block", transition: "transform 0.15s" }}>
                  ▶
                </span>
                Archive ({archivedDocs.length} document{archivedDocs.length !== 1 ? "s" : ""})
              </button>
              {showArchived && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem",
                  paddingLeft: "1rem", borderLeft: "2px solid #e7e5e4" }}>
                  {archivedDocs.map(doc => <DocRow key={doc.id} doc={doc} isArchived={true} />)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
