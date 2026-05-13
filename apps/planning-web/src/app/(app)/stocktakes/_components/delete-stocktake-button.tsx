"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Props {
  stocktakeId: string;
  reference: string | null;
}

export default function DeleteStocktakeButton({ stocktakeId, reference }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doDelete() {
    setBusy(true); setErr(null);
    const { error } = await supabase.from("stocktakes").delete().eq("id", stocktakeId);
    if (error) { setErr(error.message); setBusy(false); return; }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-secondary"
        style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem", color: "#b91c1c", borderColor: "#fca5a5" }}
        title="Delete this draft stocktake"
      >
        Delete
      </button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
          }}
          // No backdrop close — only Cancel / Delete buttons close the dialog.
        >
          <div
            style={{
              background: "white", borderRadius: "0.75rem",
              width: "min(440px, 100%)", padding: "1.25rem 1.5rem",
              boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.0625rem" }}>Delete this stocktake?</h3>
            <p style={{ margin: 0, fontSize: "0.875rem", color: "#57534e", lineHeight: 1.5 }}>
              <strong style={{ fontFamily: "monospace" }}>{reference ?? stocktakeId}</strong> will be permanently removed,
              along with all line counts entered for it. This cannot be undone.
              Submitted stocktakes are protected and cannot be deleted.
            </p>
            {err && (
              <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#991b1b", fontSize: "0.8125rem" }}>
                {err}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
              <button onClick={() => setOpen(false)} className="btn-secondary" disabled={busy}>Cancel</button>
              <button onClick={doDelete} className="btn-primary" disabled={busy} style={{ background: "#b91c1c" }}>
                {busy ? "Deleting…" : "Delete stocktake"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
