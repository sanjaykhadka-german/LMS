"use client";

/**
 * Specs summary table.
 *
 * Tino May 2026: rewrite — was rendering on a dark/inverted palette that
 * was hard to read. Now uses the same light theme as the rest of the app
 * (white card, dark text on light borders). Row click opens the spec
 * detail / preview (read-only); Edit lives on the detail page itself, not
 * on the row. Preview button on the row stays as a quick way to jump
 * straight to print mode.
 *
 * Filters: search by code/name/version + status filter + department
 * filter. Selection checkboxes drive Phase 3I.3 — Send selected — which
 * opens a modal collecting one recipient and emails the chosen spec
 * PDFs in one batch (each generates its own audit row in spec_sends).
 */

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sendProductSpecsBulk } from "../actions";

type Spec = {
  id: string;
  version: number;
  version_label: string;
  status: "draft" | "approved";
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  internal_notes: string | null;
  item: { id: string; code: string; name: string; item_type: string; department: string | null } | null;
  approver: { id: string; full_name: string } | null;
  creator: { id: string; full_name: string } | null;
  sends: { id: string }[];
};

export default function SpecsTable({ specs }: { specs: Spec[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "approved">("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const departments = useMemo(() => {
    const depts = new Set(specs.map(s => s.item?.department ?? "").filter(Boolean));
    return Array.from(depts).sort();
  }, [specs]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return specs.filter(s => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (deptFilter !== "all" && (s.item?.department ?? "") !== deptFilter) return false;
      if (q) {
        return (
          s.item?.name?.toLowerCase().includes(q) ||
          s.item?.code?.toLowerCase().includes(q) ||
          s.version_label?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [specs, search, statusFilter, deptFilter]);

  function fmtDate(d: string | null) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(s => s.id)));
  }
  const allSelected = filtered.length > 0 && selected.size === filtered.length;
  const someSelected = selected.size > 0 && !allSelected;

  // ── Bulk send modal state (Phase 3I.3) ────────────────────────────────
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDocType, setBulkDocType] = useState<"spec" | "pif">("spec");
  const [bulkName, setBulkName] = useState("");
  const [bulkEmail, setBulkEmail] = useState("");
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkResults, setBulkResults] = useState<{ specId: string; ok: boolean; error?: string }[]>([]);

  async function runBulkSend() {
    if (!bulkEmail.trim()) return;
    setBulkSending(true);
    setBulkResults([]);
    // Phase 3I.7 — single email with N attachments. The server action does
    // the loop; we just await one call and render the per-spec status that
    // comes back in `results`.
    const r = await sendProductSpecsBulk({
      specIds: Array.from(selected),
      documentType: bulkDocType,
      recipientName: bulkName.trim() || null,
      recipientEmail: bulkEmail.trim(),
      customerId: null,
      notes: bulkNotes.trim() || null,
    });
    setBulkSending(false);
    setBulkResults(r.results ?? []);
    if (r.ok) {
      setTimeout(() => { setBulkOpen(false); setSelected(new Set()); router.refresh(); }, 1100);
    } else {
      router.refresh();
    }
  }

  return (
    <div>
      {/* Filters + bulk actions */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="search"
          placeholder="Search product, code, version…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="form-input"
          style={{ width: "260px" }}
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as "all" | "draft" | "approved")} className="form-input" style={{ width: "150px" }}>
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="approved">Approved</option>
        </select>
        {departments.length > 0 && (
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="form-input" style={{ width: "200px" }}>
            <option value="all">All departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        {(search || statusFilter !== "all" || deptFilter !== "all") && (
          <button
            type="button"
            onClick={() => { setSearch(""); setStatusFilter("all"); setDeptFilter("all"); }}
            className="btn-secondary"
            style={{ fontSize: "0.8125rem" }}
          >
            Clear filters
          </button>
        )}
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => { setBulkResults([]); setBulkOpen(true); }}
            style={{ padding: "0.4rem 0.875rem", background: "#1c1917", border: "none", borderRadius: "0.375rem", color: "#fff", fontWeight: 600, fontSize: "0.8125rem", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
            title="Send the selected specs as PDF attachments to one recipient"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            Send {selected.size} selected
          </button>
        )}
        <span style={{ fontSize: "0.8125rem", color: "#78716c", marginLeft: "auto" }}>
          {filtered.length} spec{filtered.length !== 1 ? "s" : ""}
          {selected.size > 0 && <span style={{ marginLeft: "0.5rem", color: "#1e3a8a", fontWeight: 600 }}>· {selected.size} selected</span>}
        </span>
      </div>

      {/* Bulk send modal */}
      {bulkOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => !bulkSending && setBulkOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "0.5rem", padding: "1.5rem", width: "min(480px, 92vw)", maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, color: "#1c1917" }}>Send {selected.size} spec{selected.size !== 1 ? "s" : ""}</h2>
            <p style={{ margin: "0.25rem 0 1rem", fontSize: "0.8125rem", color: "#78716c" }}>
              All selected PDFs are attached to a single email to the recipient. You and your QA address are Cc&apos;d.
            </p>
            <label style={modalLbl}>Document type (applied to every send)</label>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.875rem" }}>
              {(["spec", "pif"] as const).map(t => (
                <button key={t} type="button" onClick={() => setBulkDocType(t)} disabled={bulkSending}
                  style={{ flex: 1, padding: "0.5rem", border: "1px solid", borderColor: bulkDocType === t ? "#1c1917" : "#d6d3d1", borderRadius: "0.375rem", background: bulkDocType === t ? "#1c1917" : "#fff", color: bulkDocType === t ? "#fff" : "#1c1917", fontWeight: 600, fontSize: "0.8125rem", cursor: bulkSending ? "not-allowed" : "pointer" }}>
                  {t === "spec" ? "Spec sheet" : "PIF"}
                </button>
              ))}
            </div>
            <label style={modalLbl}>Recipient name</label>
            <input type="text" value={bulkName} onChange={e => setBulkName(e.target.value)} placeholder="Optional" disabled={bulkSending} style={modalInp} />
            <label style={modalLbl}>Recipient email *</label>
            <input type="email" value={bulkEmail} onChange={e => setBulkEmail(e.target.value)} placeholder="customer@example.com" disabled={bulkSending} style={modalInp} />
            <label style={modalLbl}>Note (optional)</label>
            <textarea value={bulkNotes} onChange={e => setBulkNotes(e.target.value)} rows={2} disabled={bulkSending} style={{ ...modalInp, fontFamily: "inherit", resize: "vertical" }} />
            {bulkResults.length > 0 && (
              <div style={{ marginTop: "0.875rem", padding: "0.625rem", background: "#fafaf9", borderRadius: "0.375rem", fontSize: "0.8125rem", maxHeight: "180px", overflow: "auto" }}>
                {bulkResults.map(r => {
                  const sp = filtered.find(s => s.id === r.specId);
                  return (
                    <div key={r.specId} style={{ display: "flex", justifyContent: "space-between", padding: "0.2rem 0", color: r.ok ? "#166534" : "#991b1b" }}>
                      <span>{sp?.item?.name ?? r.specId}</span>
                      <span style={{ fontWeight: 600 }}>{r.ok ? "✓ sent" : "✗ " + (r.error?.slice(0, 40) ?? "failed")}</span>
                    </div>
                  );
                })}
                {bulkSending && <div style={{ marginTop: "0.4rem", color: "#78716c" }}>Sending {bulkResults.length} of {selected.size}…</div>}
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button type="button" onClick={() => setBulkOpen(false)} disabled={bulkSending}
                style={{ padding: "0.5rem 1rem", background: "#fff", border: "1px solid #d6d3d1", borderRadius: "0.375rem", fontWeight: 600, fontSize: "0.8125rem", cursor: bulkSending ? "not-allowed" : "pointer" }}>
                {bulkResults.length > 0 && !bulkSending ? "Close" : "Cancel"}
              </button>
              <button type="button" onClick={runBulkSend} disabled={bulkSending || !bulkEmail.trim()}
                style={{ padding: "0.5rem 1rem", background: bulkSending ? "#a8a29e" : "#b91c1c", border: "none", borderRadius: "0.375rem", color: "#fff", fontWeight: 600, fontSize: "0.8125rem", cursor: bulkSending ? "wait" : "pointer" }}>
                {bulkSending ? `Sending… (${bulkResults.length}/${selected.size})` : `Send ${selected.size} PDF${selected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem 2rem", color: "#78716c" }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto 1rem", display: "block", opacity: 0.4 }}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <p style={{ margin: 0, fontWeight: 600, color: "#1c1917" }}>No spec sheets match those filters</p>
          <p style={{ margin: "0.5rem 0 1.5rem", fontSize: "0.875rem" }}>Try clearing the filters or create a new spec.</p>
          <Link href="/specs/new" className="btn-primary">+ New Spec</Link>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem", background: "#fff", color: "#1c1917" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e7e5e4", background: "#fafaf9" }}>
                <th style={{ width: "36px", padding: "0.625rem 0.5rem 0.625rem 1rem", textAlign: "left" }}>
                  <input type="checkbox" checked={allSelected} ref={el => { if (el) el.indeterminate = someSelected; }} onChange={toggleAll} title="Select all visible" style={{ cursor: "pointer" }} />
                </th>
                {[
                  ["Product",    "auto"],
                  ["Version",    "100px"],
                  ["Status",     "120px"],
                  ["Department", "140px"],
                  ["Approved",   "150px"],
                  ["Sends",      "70px"],
                  ["Updated",    "120px"],
                ].map(([label, w]) => (
                  <th key={label} style={{ width: w, padding: "0.625rem 1rem", textAlign: "left", fontWeight: 700, color: "#57534e", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {label}
                  </th>
                ))}
                <th style={{ padding: "0.625rem 1rem" }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((spec, i) => {
                const isSelected = selected.has(spec.id);
                return (
                  <tr
                    key={spec.id}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest("input[type=checkbox], a, button")) return;
                      router.push(`/specs/${spec.id}/preview`);
                    }}
                    style={{
                      borderBottom: i < filtered.length - 1 ? "1px solid #f5f5f4" : "none",
                      background: isSelected ? "#eff6ff" : "#fff",
                      cursor: "pointer",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "#fafaf9"; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "#fff"; }}
                  >
                    <td style={{ padding: "0.75rem 0.5rem 0.75rem 1rem" }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(spec.id)} style={{ cursor: "pointer" }} />
                    </td>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <div style={{ fontWeight: 600, color: "#1c1917" }}>{spec.item?.name ?? "—"}</div>
                      <div style={{ fontSize: "0.75rem", color: "#78716c", fontFamily: "monospace" }}>{spec.item?.code}</div>
                    </td>
                    <td style={{ padding: "0.75rem 1rem", color: "#44403c" }}>v{spec.version_label}</td>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", padding: "0.2rem 0.625rem", borderRadius: "9999px", fontSize: "0.6875rem", fontWeight: 700, background: spec.status === "approved" ? "#dcfce7" : "#fef3c7", color: spec.status === "approved" ? "#166534" : "#854d0e", border: `1px solid ${spec.status === "approved" ? "#86efac" : "#fde047"}` }}>
                        <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: spec.status === "approved" ? "#16a34a" : "#ca8a04", flexShrink: 0 }} />
                        {spec.status === "approved" ? "Approved" : "Draft"}
                      </span>
                    </td>
                    <td style={{ padding: "0.75rem 1rem", color: "#44403c" }}>{spec.item?.department ?? "—"}</td>
                    <td style={{ padding: "0.75rem 1rem", color: "#44403c", fontSize: "0.8125rem" }}>
                      {spec.approved_at ? (
                        <div>
                          <div>{fmtDate(spec.approved_at)}</div>
                          {spec.approver && <div style={{ color: "#78716c", fontSize: "0.7rem" }}>{spec.approver.full_name}</div>}
                        </div>
                      ) : <span style={{ color: "#a8a29e" }}>—</span>}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", color: "#44403c" }}>
                      {spec.sends.length > 0 ? <span style={{ color: "#1c1917", fontWeight: 700 }}>{spec.sends.length}</span> : <span style={{ color: "#a8a29e" }}>—</span>}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", color: "#78716c", fontSize: "0.8125rem" }}>{fmtDate(spec.updated_at)}</td>
                    <td style={{ padding: "0.75rem 1rem", textAlign: "right" }}>
                      <Link href={`/specs/${spec.id}/preview`} onClick={e => e.stopPropagation()} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem", display: "inline-flex", alignItems: "center", gap: "0.375rem" }} title="Open the print-ready preview">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                        </svg>
                        Preview
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const modalLbl: React.CSSProperties = { display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#57534e", marginBottom: "0.25rem", marginTop: "0.5rem", textTransform: "uppercase", letterSpacing: "0.04em" };
const modalInp: React.CSSProperties = { width: "100%", padding: "0.5rem 0.625rem", border: "1px solid #d6d3d1", borderRadius: "0.375rem", fontSize: "0.875rem", color: "#1c1917", background: "#fff" };
