"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type MachineDoc = {
  id: string;
  document_type: string;
  title: string;
  description: string | null;
  document_url: string | null;
  document_name: string | null;
  version: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  uploaded_by: { full_name: string } | null;
  created_at: string;
};

const DOC_TYPES = ["manual","sop","training_video","certificate","inspection","other"] as const;
const DOC_TYPE_LABELS: Record<string, string> = {
  manual: "Manual", sop: "SOP", training_video: "Training Video",
  certificate: "Certificate", inspection: "Inspection Report", other: "Other",
};
const DOC_TYPE_COLORS: Record<string, string> = {
  manual: "badge-blue", sop: "badge-green", training_video: "badge-blue",
  certificate: "badge-green", inspection: "badge-gray", other: "badge-gray",
};

const BLANK = { document_type: "sop", title: "", description: "", version: "", effective_date: "", expiry_date: "" };

export default function MachineDocumentsPanel({
  machineId, initialDocuments,
}: { machineId: string; initialDocuments: MachineDoc[] }) {
  const supabase = createClient();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.title.trim()) { setError("Title is required"); return; }
    setSaving(true); setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();

    let documentUrl: string | null = null;
    let documentName: string | null = null;
    let fileSizeBytes: number | null = null;

    if (file) {
      const ext = file.name.split(".").pop();
      const path = `${profile!.tenant_id}/machines/${machineId}/${Date.now()}_${form.title.replace(/\s+/g, "_")}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("machine-docs").upload(path, file);
      if (uploadErr) { setError(`Upload failed: ${uploadErr.message}`); setSaving(false); return; }
      documentUrl = path;
      documentName = file.name;
      fileSizeBytes = file.size;
    }

    const { error: insertErr } = await supabase.from("machine_documents").insert({
      tenant_id: profile!.tenant_id,
      machine_id: machineId,
      document_type: form.document_type,
      title: form.title.trim(),
      description: form.description || null,
      version: form.version || null,
      effective_date: form.effective_date || null,
      expiry_date: form.expiry_date || null,
      document_url: documentUrl,
      document_name: documentName,
      file_size_bytes: fileSizeBytes,
      uploaded_by: user!.id,
    });

    if (insertErr) { setError(insertErr.message); setSaving(false); return; }

    setSaving(false); setShowForm(false); setForm(BLANK); setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  async function deleteDoc(doc: MachineDoc) {
    if (!confirm(`Delete "${doc.title}"?`)) return;
    if (doc.document_url) {
      await supabase.storage.from("machine-docs").remove([doc.document_url]);
    }
    await supabase.from("machine_documents").delete().eq("id", doc.id);
    router.refresh();
  }

  async function getDownloadUrl(doc: MachineDoc) {
    if (!doc.document_url) return;
    const { data } = await supabase.storage.from("machine-docs").createSignedUrl(doc.document_url, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  const expiringSoon = initialDocuments.filter(d => {
    if (!d.expiry_date) return false;
    const exp = new Date(d.expiry_date);
    const in60 = new Date(); in60.setDate(in60.getDate() + 60);
    return exp <= in60;
  });

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>
            Documents, Manuals &amp; SOPs
            {expiringSoon.length > 0 && (
              <span style={{ marginLeft: "0.5rem", background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5",
                borderRadius: "999px", fontSize: "0.75rem", padding: "0.1rem 0.5rem", fontWeight: 600 }}>
                {expiringSoon.length} expiring
              </span>
            )}
          </h2>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
          + Add Document
        </button>
      </div>

      {showForm && (
        <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem", padding: "1rem", marginBottom: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <div>
              <label className="form-label">Type</label>
              <select className="form-select" value={form.document_type} onChange={e => set("document_type", e.target.value)}>
                {DOC_TYPES.map(t => <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Title *</label>
              <input className="form-input" value={form.title} onChange={e => set("title", e.target.value)}
                placeholder="e.g. Kerres Smoker Operating Manual" />
            </div>
            <div>
              <label className="form-label">Version</label>
              <input className="form-input" value={form.version} onChange={e => set("version", e.target.value)} placeholder="e.g. v2.1" />
            </div>
            <div>
              <label className="form-label">Effective Date</label>
              <input className="form-input" type="date" value={form.effective_date} onChange={e => set("effective_date", e.target.value)} />
            </div>
            <div>
              <label className="form-label">Expiry Date</label>
              <input className="form-input" type="date" value={form.expiry_date} onChange={e => set("expiry_date", e.target.value)} />
            </div>
            <div>
              <label className="form-label">File (PDF, Image, Video, Word)</label>
              <input ref={fileRef} type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.mp4,.webm,.doc,.docx,.xls,.xlsx"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="form-input" style={{ padding: "0.375rem" }} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Description</label>
              <input className="form-input" value={form.description} onChange={e => set("description", e.target.value)}
                placeholder="Optional notes about this document" />
            </div>
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: "0.875rem", margin: "0 0 0.5rem" }}>{error}</p>}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={save} className="btn-primary" disabled={saving} style={{ fontSize: "0.8125rem" }}>
              {saving ? "Uploading…" : "Add Document"}
            </button>
            <button onClick={() => { setShowForm(false); setError(null); }} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Cancel</button>
          </div>
        </div>
      )}

      {initialDocuments.length === 0 ? (
        <p style={{ color: "#78716c", fontSize: "0.875rem" }}>No documents uploaded yet. Add manuals, SOPs, training videos and certificates here.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Type</th><th>Title</th><th>Version</th><th>Expiry</th><th>File</th><th></th></tr>
          </thead>
          <tbody>
            {initialDocuments.map(d => {
              const exp = d.expiry_date ? new Date(d.expiry_date) : null;
              const today = new Date();
              const in60 = new Date(); in60.setDate(today.getDate() + 60);
              const expired = exp && exp < today;
              const expiring = exp && !expired && exp <= in60;
              return (
                <tr key={d.id}>
                  <td>
                    <span className={`badge ${DOC_TYPE_COLORS[d.document_type]}`} style={{ fontSize: "0.6875rem" }}>
                      {DOC_TYPE_LABELS[d.document_type]}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>{d.title}</div>
                    {d.description && <div style={{ color: "#78716c", fontSize: "0.75rem" }}>{d.description}</div>}
                  </td>
                  <td style={{ color: "#78716c", fontSize: "0.8125rem" }}>{d.version ?? "—"}</td>
                  <td>
                    {exp ? (
                      <span style={{ fontSize: "0.8125rem", fontWeight: expired || expiring ? 600 : 400,
                        color: expired ? "#dc2626" : expiring ? "#d97706" : "inherit" }}>
                        {exp.toLocaleDateString("en-AU")}
                        {expired ? " ✗ Expired" : expiring ? " ⚠ Expiring" : ""}
                      </span>
                    ) : <span style={{ color: "#a8a29e", fontSize: "0.8125rem" }}>—</span>}
                  </td>
                  <td>
                    {d.document_url ? (
                      <button onClick={() => getDownloadUrl(d)}
                        style={{ fontSize: "0.8125rem", color: "#b91c1c", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                        {d.document_name ?? "Download"}
                      </button>
                    ) : <span style={{ color: "#a8a29e", fontSize: "0.8125rem" }}>No file</span>}
                  </td>
                  <td>
                    <button onClick={() => deleteDoc(d)}
                      style={{ fontSize: "0.75rem", background: "none", border: "1px solid #fca5a5",
                        borderRadius: "0.375rem", color: "#dc2626", cursor: "pointer", padding: "0.2rem 0.5rem" }}>
                      Delete
                    </button>
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
