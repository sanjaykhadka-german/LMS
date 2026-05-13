"use client";

/**
 * Item detail page — "Supplier Specifications" panel.
 *
 * Lists every spec document this item has from every supplier, grouped by
 * supplier. Each row shows the supplier's name, their internal product
 * code/name (sourced from supplier_items joined to the same item), the
 * doc title + version + effective date, and a 👁 Preview button that
 * opens the spec inline via SpecPreviewModal.
 *
 * Specs uploaded WITHOUT a supplier_id (e.g. internal GB-generated specs
 * that don't belong to any supplier) are excluded — those live on the
 * existing /specs page and the bigger "Spec Documents" panel below this
 * one. This panel is specifically for "what each supplier sent us".
 *
 * Adds happen via the existing ItemSpecDocsPanel below this section. We
 * intentionally don't duplicate the upload UI — keep this panel a focused
 * read+preview view, with a small "+ Add spec" link that scrolls down to
 * the full ItemSpecDocsPanel form.
 */

import { useState, useMemo } from "react";
import SpecPreviewModal, { type SpecPreviewDoc } from "@/components/spec-preview-modal";

type SpecDoc = {
  id: string;
  document_type: string | null;
  title: string;
  version: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  supplier_id: string | null;
  document_url: string | null;
  document_name: string | null;
  mime_type: string | null;
  supplier?: { id: string; name: string } | null;
};

type SupplierItemLink = {
  supplier_item_code: string | null;
  supplier_item_name: string | null;
  supplier?: { id: string; name: string } | null;
};

export default function ItemSupplierSpecsPanel({
  docs,
  supplierLinks,
}: {
  docs: SpecDoc[];
  supplierLinks: SupplierItemLink[];
}) {
  const [previewDoc, setPreviewDoc] = useState<SpecPreviewDoc | null>(null);

  // Build a (supplier_id → supplier_item_name + code) map so each spec row
  // can show the supplier's own name for the product. Lets the operator
  // verify "yes, this is the same as their CSP-2031.075 product".
  const supplierProductMap = useMemo(() => {
    const m = new Map<string, { code: string | null; name: string | null }>();
    for (const link of supplierLinks) {
      const sid = link.supplier?.id;
      if (!sid) continue;
      m.set(sid, { code: link.supplier_item_code, name: link.supplier_item_name });
    }
    return m;
  }, [supplierLinks]);

  // Group spec docs by supplier. Drop docs without a supplier — those are
  // GB-internal specs and surface in the other panel.
  const grouped = useMemo(() => {
    const m = new Map<string, { supplierId: string; supplierName: string; docs: SpecDoc[] }>();
    for (const d of docs) {
      const sid = d.supplier?.id ?? d.supplier_id;
      if (!sid) continue;
      const name = d.supplier?.name ?? "(unknown supplier)";
      if (!m.has(sid)) m.set(sid, { supplierId: sid, supplierName: name, docs: [] });
      m.get(sid)!.docs.push(d);
    }
    // Sort suppliers alphabetically; within each supplier sort newest-first.
    return [...m.values()]
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName))
      .map(g => ({
        ...g,
        docs: [...g.docs].sort((a, b) => {
          const ad = a.effective_date ?? "";
          const bd = b.effective_date ?? "";
          return bd.localeCompare(ad);
        }),
      }));
  }, [docs]);

  function openPreview(d: SpecDoc) {
    setPreviewDoc({
      title: d.title,
      documentName: d.document_name,
      mimeType: d.mime_type,
      // document_url may be either a public URL or a storage path. Pass
      // it as documentUrl when it looks like an http(s) URL; otherwise
      // hand it as storagePath so the modal mints a signed URL.
      ...(d.document_url && /^https?:\/\//i.test(d.document_url)
        ? { documentUrl: d.document_url }
        : { storagePath: d.document_url ?? null }),
    });
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>Supplier Specifications</h2>
        <span style={{ fontSize: "0.75rem", color: "#78716c" }}>
          {grouped.length} supplier{grouped.length === 1 ? "" : "s"} · {grouped.reduce((n, g) => n + g.docs.length, 0)} doc{grouped.reduce((n, g) => n + g.docs.length, 0) === 1 ? "" : "s"}
        </span>
      </div>

      {grouped.length === 0 ? (
        <div style={{ padding: "1.25rem", fontSize: "0.8125rem", color: "#a8a29e" }}>
          No supplier-supplied specifications yet. Upload via the <strong>Spec Documents</strong> panel below and pick a supplier.
        </div>
      ) : (
        <div>
          {grouped.map(group => {
            const sp = supplierProductMap.get(group.supplierId);
            return (
              <div key={group.supplierId} style={{ borderBottom: "1px solid #f5f5f4" }}>
                <div style={{ padding: "0.625rem 1.25rem", background: "#fafaf9", display: "flex", alignItems: "baseline", gap: "0.625rem", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.875rem", color: "#1c1917" }}>{group.supplierName}</span>
                  {sp && (sp.code || sp.name) && (
                    <span style={{ fontSize: "0.75rem", color: "#57534e" }}>
                      Their product: {sp.code ? <code style={{ fontFamily: "monospace", color: "#1c1917" }}>{sp.code}</code> : null}
                      {sp.code && sp.name ? " · " : ""}
                      {sp.name ?? ""}
                    </span>
                  )}
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
                            <span style={{ fontSize: "0.7rem", color: "#78716c" }}>
                              v{d.version}
                            </span>
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
            );
          })}
        </div>
      )}

      {previewDoc && (
        <SpecPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}
    </div>
  );
}
