"use client";

/**
 * Full-screen in-page modal that previews a supplier-supplied specification
 * document (PDF or image). Used from both the item detail page (Supplier
 * Specifications panel) and the supplier detail page.
 *
 * The doc may be stored in private Supabase storage, in which case we need
 * to mint a fresh signed URL on open. The caller hands us either a direct
 * `documentUrl` (already signed or public) or a `storagePath` we resolve
 * client-side. Embedding rule:
 *   • PDF → <iframe> (browsers render PDFs natively in iframes)
 *   • image/* → <img>
 *   • everything else → fallback download link
 *
 * ESC closes; click on the dim backdrop closes; body scroll is locked.
 * Same UX shape as work-order-modal.tsx so the operator's mental model
 * stays consistent.
 */

import { useEffect, useState } from "react";
import { traceyStorage } from "@/lib/storage/client";

export type SpecPreviewDoc = {
  title: string;
  documentName: string | null;
  mimeType: string | null;
  /** Direct URL — used when the doc is already public or a signed URL has
   *  been minted server-side. Skip storagePath when this is set. */
  documentUrl?: string | null;
  /** Path inside the `item-spec-docs` storage bucket. Resolved to a signed
   *  URL on open when documentUrl is absent. */
  storagePath?: string | null;
  /** Storage bucket name. Defaults to "item-specs". */
  bucket?: string;
};

export default function SpecPreviewModal({
  doc,
  onClose,
}: {
  doc: SpecPreviewDoc;
  onClose: () => void;
}) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(doc.documentUrl ?? null);
  const [error, setError] = useState<string | null>(null);

  // ESC closes — listen on window so focus inside an iframe still works.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Resolve a signed URL when only a storage path was provided. Done lazily
  // on mount rather than at render time on the parent so the parent doesn't
  // mint URLs for every spec it lists (some panels render dozens).
  useEffect(() => {
    if (resolvedUrl) return;
    if (!doc.storagePath) return;
    const bucket = doc.bucket ?? "item-specs";
    let cancelled = false;
    (async () => {
      const { data, error } = await traceyStorage()
        .from(bucket)
        .createSignedUrl(doc.storagePath!, 3600);
      if (cancelled) return;
      if (error) setError(error.message);
      else setResolvedUrl(data?.signedUrl ?? null);
    })();
    return () => { cancelled = true; };
  }, [resolvedUrl, doc.storagePath, doc.bucket]);

  // Decide how to render the body. PDFs and images preview inline; anything
  // else falls back to a download link rather than embedding something the
  // browser can't render.
  const mime = (doc.mimeType ?? "").toLowerCase();
  const isPdf = mime === "application/pdf" || (doc.documentName ?? "").toLowerCase().endsWith(".pdf");
  const isImage = mime.startsWith("image/");

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "stretch", justifyContent: "center",
        padding: "0.5rem",
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          background: "#fff", borderRadius: "0.5rem", overflow: "hidden",
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
          display: "flex", flexDirection: "column",
          width: "100%", maxWidth: "1200px", height: "100%",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0.625rem 0.875rem", borderBottom: "1px solid #e7e5e4",
          background: "#1c1917", color: "#fff", flexShrink: 0, gap: "0.75rem",
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              📄 {doc.title}
            </div>
            {doc.documentName && (
              <div style={{ fontSize: "0.7rem", opacity: 0.75, marginTop: "0.1rem" }}>{doc.documentName}</div>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
            {resolvedUrl && (
              <a
                href={resolvedUrl}
                target="_blank"
                rel="noopener"
                style={{
                  background: "rgba(255,255,255,0.1)", color: "#fff",
                  border: "1px solid #57534e", borderRadius: "0.375rem",
                  padding: "0.35rem 0.75rem", fontSize: "0.8125rem",
                  fontWeight: 600, textDecoration: "none",
                }}
              >
                ↗ Open in new tab
              </a>
            )}
            <button
              onClick={onClose}
              style={{
                background: "rgba(255,255,255,0.1)", color: "#fff",
                border: "1px solid #57534e", borderRadius: "0.375rem",
                padding: "0.35rem 0.75rem", cursor: "pointer", fontSize: "0.8125rem",
                fontWeight: 600,
              }}
              aria-label="Close preview"
            >
              ✕ Close
            </button>
          </div>
        </div>

        <div style={{ flex: 1, background: "#f5f5f4", display: "flex", alignItems: "stretch", justifyContent: "center" }}>
          {error ? (
            <div style={{ padding: "2rem", color: "#dc2626", textAlign: "center", alignSelf: "center" }}>
              Couldn&apos;t load the spec — {error}
            </div>
          ) : !resolvedUrl ? (
            <div style={{ padding: "2rem", color: "#78716c", textAlign: "center", alignSelf: "center" }}>
              Loading preview…
            </div>
          ) : isPdf ? (
            <iframe src={resolvedUrl} title={doc.title} style={{ border: "none", width: "100%", height: "100%", background: "#fff" }} />
          ) : isImage ? (
            <img src={resolvedUrl} alt={doc.title} style={{ maxWidth: "100%", maxHeight: "100%", margin: "auto", objectFit: "contain", padding: "1rem" }} />
          ) : (
            <div style={{ padding: "2rem", color: "#57534e", textAlign: "center", alignSelf: "center" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📎</div>
              <p>Preview isn&apos;t available for this file type ({mime || "unknown"}).</p>
              <p style={{ marginTop: "0.5rem" }}>
                <a href={resolvedUrl} target="_blank" rel="noopener" style={{ color: "#1e40af", fontWeight: 600 }}>
                  Open / download {doc.documentName ?? "the file"}
                </a>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
