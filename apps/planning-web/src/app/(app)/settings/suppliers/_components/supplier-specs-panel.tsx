"use client";

/**
 * Supplier detail page — "Specifications" panel.
 *
 * Shows every spec document this supplier has uploaded across every item
 * in the catalogue, grouped by item. Each row links back to the item
 * detail page (via popup) and offers a 👁 Preview button that opens the
 * spec inline using SpecPreviewModal.
 *
 * Data lives in item_spec_documents (filtered by supplier_id). Schema
 * already supports this — no migration needed. Adds happen via the
 * existing item-side ItemSpecDocsPanel; this panel is purely a
 * read+preview convenience for "what specs do we have on file from
 * Supplier X?".
 */

import { useState, useMemo } from "react";
import { openItemInPopup } from "@/lib/popup";
import SpecPreviewModal, { type SpecPreviewDoc } from "@/components/spec-preview-modal";

type SpecDoc = {
  id: string;
  document_type: string | null;
  title: string;
  version: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  document_url: string | null;
  document_name: string | null;
  mime_type: string | null;
  item: { id: string; code: string; name: string } | null;
};

export default function SupplierSpecsPanel({
  docs,
}: {
  docs: SpecDoc[];
}) {
  const [previewDoc, setPreviewDoc] = useState<SpecPreviewDoc | null>(null);

  // Group by item — surfaces "this supplier has specs for these N items"
  // as the primary navigation rather than a flat doc list.
  const grouped = useMemo(() => {
    const m = new Map<string, { itemId: string; code: string; name: string; docs: SpecDoc[] }>();
    for (const d of docs) {
      if (!d.item) continue;
      if (!m.has(d.item.id)) {
        m.set(d.item.id, { itemId: d.item.id, code: d.item.code, name: d.item.name, docs: [] });
      }
      m.get(d.item.id)!.docs.push(d);
    }
    return [...m.values()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(g => ({
        ...g,
        docs: [...g.docs].sort((a, b) => (b.effective_date ?? "").localeCompare(a.effective_date ?? "")),
      }));
  }, [docs]);

  function openPreview(d: SpecDoc) {
    setPreviewDoc({
      title: d.title,
      documentName: d.document_name,
      mimeType: d.mime_type,
      ...(d.document_url && /^https?:\/\//i.test(d.document_url)
        ? { documentUrl: d.document_url }
        : { storagePath: d.document_url ?? null }),
    });
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>Specifications</h2>
        <span style={{ fontSize: "0.75rem", color: "#78716c" }}>
          {grouped.length} item{grouped.length === 1 ? "" : "s"} · {docs.length} doc{docs.length === 1 ? "" : "s"}
        </span>
      </div>

      {grouped.length === 0 ? (
        <div style={{ padding: "1.25rem", fontSize: "0.8125rem", color: "#a8a29e" }}>
          No specifications uploaded for this supplier yet. Add specs from the relevant item&apos;s detail page (Item Master → item → Spec Documents → pick this supplier).
        </div>
      ) : (
        <div>
          {grouped.map(group => (
            <div key={group.itemId} style={{ borderBottom: "1px solid #f5f5f4" }}>
              <div style={{ padding: "0.625rem 1.25rem", background: "#fafaf9", display: "flex", alignItems: "baseline", gap: "0.625rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => openItemInPopup(group.itemId)}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 600, fontSize: "0.875rem", color: "#1c1917", textDecoration: "underline", fontFamily: "inherit" }}
                  title="Open this item in a new window"
                >
                  <span style={{ fontFamily: "monospace", color: "#78716c", marginRight: "0.5rem" }}>{group.code}</span>
                  {group.name}
                </button>
                <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "#a8a29e" }}>
                  {group.docs.length} doc{group.docs.length === 1 ? "" : "s"}
                </span>
              </div>
              <div>
                {group.docs.map(d => (
                  <div
                    key={d.id}
                    style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.625rem 1.25rem", borderTop: "1px solid #f5f5f4" }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: "0.875rem", color: "#1c1917", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                        📄 {d.title}
                        {d.document_type && (
                          <span style={{ fontSize: "0.65rem", padding: "0.1rem 0.4rem", background: "#e7e5e4", borderRadius: "0.25rem", color: "#57534e", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            {d.document_type}
                          </span>
                        )}
                        {d.version && (
                          <span style={{ fontSize: "0.7rem", color: "#78716c" }}>v{d.version}</span>
                        )}
                      </div>
                      <div style={{ fontSize: "0.7rem", color: "#78716c", marginTop: "0.15rem", display: "flex", gap: "0.625rem", flexWrap: "wrap" }}>
                        {d.document_name && <span style={{ fontFamily: "monospace" }}>{d.document_name}</span>}
                        {d.effective_date && <span>Effective {new Date(d.effective_date).toLocaleDateString("en-AU")}</span>}
                        {d.expiry_date && (() => {
                          const expired = new Date(d.expiry_date) < new Date();
                          return (
                            <span style={{ color: expired ? "#dc2626" : "#78716c", fontWeight: expired ? 600 : 400 }}>
                              {expired ? "⚠ Expired " : "Expires "}{new Date(d.expiry_date).toLocaleDateString("en-AU")}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openPreview(d)}
                      disabled={!d.document_url}
                      title={d.document_url ? "Preview this spec inline" : "No file attached to this spec"}
                      className="btn-secondary"
                      style={{ fontSize: "0.75rem", padding: "0.3rem 0.65rem", flexShrink: 0, opacity: d.document_url ? 1 : 0.5 }}
                    >
                      👁 Preview
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {previewDoc && (
        <SpecPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}
    </div>
  );
}
