"use client";

/**
 * Full-screen in-page modal that renders the work-order detail page
 * (/work-orders/[id]) in an iframe.
 *
 * Why iframe: the work-order page is a hefty client component (~1000 lines —
 * BOM table, sortable headers, draggable nested traceability modal, lock
 * controls, sticky thead+tfoot). Re-mounting it inside another React tree
 * would mean refactoring every internal modal/popover to share z-index space
 * with the parent, plus duplicating the server-side data fetch. The iframe
 * gives us full reuse with zero refactor — the existing nested traceability
 * modal already works correctly inside its own viewport, and on tablet the
 * scrolling is contained so the parent screen doesn't drift.
 *
 * The iframe loads /work-orders/[id]?embed=1, which the page can use later
 * to hide the back button / dept link if we want a tighter chrome — for now
 * the embed flag is just a hint. ESC closes the modal.
 */

import { useEffect, useRef } from "react";

export default function WorkOrderModal({
  orderId,
  onClose,
}: {
  orderId: string;
  onClose: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ESC key closes the modal — operators using a tablet keyboard can dismiss
  // without aiming at the X button. We listen on window because focus may
  // be inside the iframe (which has its own document and won't bubble).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock body scroll while the modal is open so background swiping doesn't
  // bleed through on tablets.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      onClick={(e) => {
        // Click on the dim backdrop (but not the modal body) closes.
        if (e.target === e.currentTarget) onClose();
      }}
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
          width: "100%", maxWidth: "1400px", height: "100%",
        }}
      >
        {/* Modal title bar — shows the order id and a close button. The
            iframe's own page header still renders inside, but the parent X
            gives the operator a familiar "exit modal" target without
            having to click into the iframe and use BackButton. */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0.625rem 0.875rem", borderBottom: "1px solid #e7e5e4",
          background: "#1c1917", color: "#fff", flexShrink: 0,
        }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>
            🥩 Work order — recipe &amp; traceability
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.1)", color: "#fff",
              border: "1px solid #57534e", borderRadius: "0.375rem",
              padding: "0.35rem 0.75rem", cursor: "pointer", fontSize: "0.8125rem",
              fontWeight: 600,
            }}
            aria-label="Close work order modal"
          >
            ✕ Close
          </button>
        </div>

        {/* The iframe loads the existing /work-orders/[id] page so we get
            BOM table, work instructions, traceability modal, and lock
            controls for free. ?embed=1 is a hint for the page to drop
            redundant chrome (back link, side nav) when we wire that up. */}
        <iframe
          ref={iframeRef}
          src={`/work-orders/${orderId}?embed=1`}
          title="Work order recipe and traceability"
          style={{
            border: "none", width: "100%", flex: 1, background: "#fff",
          }}
        />
      </div>
    </div>
  );
}
