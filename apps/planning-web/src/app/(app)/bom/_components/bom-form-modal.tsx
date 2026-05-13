"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BomForm from "./bom-form";

interface Props {
  /** edit mode: pass the existing BOM id */
  bomId?: string;
  /** create mode: pass an item id to pre-select the parent product */
  defaultItemId?: string;
  /** for edit-mode header label only */
  approvedAt?: string | null;
  /** Trigger button label. Defaults: "✏️ Edit BOM" or "+ New BOM" depending on mode. */
  triggerLabel?: string;
  /** Trigger button class. Defaults: btn-secondary for edit, btn-primary for create. */
  triggerClassName?: string;
  /** Optional: open the modal on mount (e.g. when arriving from a redirect). */
  initiallyOpen?: boolean;
}

export default function BomFormModal({
  bomId, defaultItemId, approvedAt,
  triggerLabel, triggerClassName, initiallyOpen = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);

  const isEdit = !!bomId;
  const label  = triggerLabel ?? (isEdit ? "✏️ Edit BOM" : "+ New BOM Version");
  const cls    = triggerClassName ?? (isEdit ? "btn-secondary" : "btn-primary");

  const handleSaved = () => {
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <button className={cls} onClick={() => setOpen(true)}>
        {label}
      </button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 50,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            padding: "1.5rem 1rem",
          }}
          // NOTE: no backdrop-click close — operators were losing data when
          // tapping outside the modal. Only Save / Cancel / × close it now.
        >
          <div
            style={{
              background: "#f8f7f5",
              borderRadius: "0.875rem",
              width: "min(960px, 100%)",
              maxHeight: "calc(100vh - 3rem)",
              display: "flex", flexDirection: "column", overflow: "hidden",
              boxShadow: "0 24px 80px rgba(0,0,0,0.25)",
            }}
          >
            {/* Title bar */}
            <div
              style={{
                flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "0.875rem 1.25rem",
                background: "#1c1917",
                borderRadius: "0.875rem 0.875rem 0 0",
              }}
            >
              <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#f5f5f4" }}>
                {isEdit ? "Edit BOM" : "New BOM Version"}
              </h2>
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: "none", border: "none", fontSize: "1.375rem",
                  cursor: "pointer", color: "#a8a29e",
                  lineHeight: 1, padding: "0.125rem 0.375rem",
                }}
                title="Close"
              >×</button>
            </div>

            {/* Scrollable form area */}
            <div style={{ flex: 1, overflowY: "auto", padding: "1.25rem 1.5rem" }}>
              {isEdit ? (
                <BomForm
                  mode="edit"
                  bomId={bomId!}
                  initialApprovedAt={approvedAt}
                  onSaved={handleSaved}
                  onCancel={() => setOpen(false)}
                />
              ) : (
                <BomForm
                  mode="create"
                  defaultItemId={defaultItemId}
                  onSaved={handleSaved}
                  onCancel={() => setOpen(false)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
