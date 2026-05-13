"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const TRANSITIONS: Record<string, { label: string; next: string; className: string }[]> = {
  draft:     [{ label: "Mark as Sent", next: "sent", className: "btn-primary" }, { label: "Cancel", next: "cancelled", className: "btn-secondary" }],
  sent:      [{ label: "Mark as Received", next: "received", className: "btn-primary" }, { label: "Cancel", next: "cancelled", className: "btn-secondary" }],
  received:  [],
  cancelled: [],
};

export default function PurchaseOrderStatusClient({ poId, currentStatus }: { poId: string; currentStatus: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const actions = TRANSITIONS[currentStatus] ?? [];
  if (actions.length === 0) return null;

  async function transition(next: string) {
    setLoading(next);
    await supabase.from("purchase_orders").update({ status: next }).eq("id", poId);
    router.refresh();
    setLoading(null);
  }

  return (
    <div style={{ display: "flex", gap: "0.5rem" }}>
      {actions.map(a => (
        <button
          key={a.next}
          onClick={() => transition(a.next)}
          disabled={!!loading}
          className={a.className}
          style={{ fontSize: "0.8125rem" }}
        >
          {loading === a.next ? "…" : a.label}
        </button>
      ))}
    </div>
  );
}
