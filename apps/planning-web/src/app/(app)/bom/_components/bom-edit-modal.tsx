"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BomForm from "./bom-form";

interface Props {
  bomId: string;
  approvedAt?: string | null;
}

export default function BomEditModal({ bomId, approvedAt }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleSaved = () => {
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <button className="btn-secondary" onClick={() => setOpen(true)}>
        ✏️ Edit BOM
      </button>

      {open && (
        /*
         * New layout: the backdrop dims the page but does NOT scroll.
         * The panel is a fixed-height flex column:
         *   - title bar  (flexShrink: 0, always visible)
         *   - form area  (flex: 1, overflow-y: auto  ← scrolls here)
         *   - action bar (flexShrink: 0, always visible — Save / Approve / Cancel)
         *
         * Component-search dropdowns use position:fixed + getBoundingClientRect()
         * so they float above the modal and are never clipped by the scroll box.
         */
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "1.5rem 1rem",
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          {/* Panel — resizable via the drag handle in the bottom-right corner.
              Defaults wider than before (1280px) so the COMPONENT column
              breathes; user can grow it further by dragging the corner. */}
          <div
            style={{
              background: "#f8f7f5",
              borderRadius: "0.875rem",
              width: "min(1280px, 100%)",
              height: "min(900px, calc(100vh - 3rem))",
              minWidth: "640px",
              minHeight: "400px",
              maxWidth: "calc(100vw - 2rem)",
              maxHeight: "calc(100vh - 3rem)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 24px 80px rgba(0,0,0,0.25)",
              resize: "both",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Title bar */}
            <div
              style={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.875rem 1.25rem",
                background: "#1c1917",
                borderRadius: "0.875rem 0.875rem 0 0",
              }}
            >
              <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#f5f5f4" }}>
                Edit BOM
              </h2>
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "1.375rem",
                  cursor: "pointer",
                  color: "#a8a29e",
                  lineHeight: 1,
                  padding: "0.125rem 0.375rem",
                }}
                title="Close"
              >
                ×
              </button>
            </div>

            {/* Scrollable form area */}
            <div style={{ flex: 1, overflowY: "auto", padding: "1.25rem 1.5rem" }}>
              <BomForm
                mode="edit"
                bomId={bomId}
                initialApprovedAt={approvedAt}
                onSaved={handleSaved}
                onCancel={() => setOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
