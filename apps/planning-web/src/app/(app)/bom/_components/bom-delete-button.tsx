"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function BomDeleteButton({ bomId, label }: { bomId: string; label: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    // bom_lines cascade-delete automatically via FK ON DELETE CASCADE
    const { error: err } = await supabase
      .from("bom_headers")
      .delete()
      .eq("id", bomId);
    if (err) {
      setError(err.message);
      setDeleting(false);
      setConfirming(false);
      return;
    }
    router.push("/bom");
    router.refresh();
  }

  if (confirming) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        {error && (
          <span style={{ fontSize: "0.8125rem", color: "#dc2626" }}>{error}</span>
        )}
        <span style={{ fontSize: "0.8125rem", color: "#78716c" }}>
          Delete &ldquo;{label}&rdquo;?
        </span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          style={{
            padding: "0.375rem 0.75rem", fontSize: "0.8125rem",
            background: "#dc2626", color: "#fff",
            border: "none", borderRadius: "0.375rem", cursor: "pointer",
            opacity: deleting ? 0.6 : 1,
          }}
        >
          {deleting ? "Deleting…" : "Yes, delete"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={deleting}
          className="btn-secondary"
          style={{ fontSize: "0.8125rem" }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="btn-secondary"
      style={{ fontSize: "0.8125rem", color: "#dc2626", borderColor: "#fca5a5" }}
    >
      Delete Draft
    </button>
  );
}
