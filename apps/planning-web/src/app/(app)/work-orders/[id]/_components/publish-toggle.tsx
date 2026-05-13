"use client";

/**
 * Per-order publish/unpublish toggle for the work-order page header.
 *
 * Visible to admins/planners only (the page already gates this server-side
 * by passing isAdmin). Three states it can render:
 *
 *   • Published & planned  → "✕ Unpublish" button. Clicking flips published_at
 *     back to null so the order disappears from the floor and the planner can
 *     edit it without disturbing the rest of the dept.
 *   • Unpublished, planned, has production_date → "📤 Publish to floor" button.
 *     Stamps published_at = now.
 *   • Unpublished, planned, no production_date → disabled "Set date first" button.
 *   • Order past 'planned' status → no button (it's too late, operator started).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { publishProductionOrder, unpublishProductionOrder } from "../../../plans/actions";

export default function PublishToggle({
  orderId,
  isPublished,
  status,
  hasProductionDate,
  isAdmin,
}: {
  orderId: string;
  isPublished: boolean;
  status: string;
  hasProductionDate: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Floor operators don't get this control — only planners/admins set
  // publish state. The work-order page already passes isAdmin server-side.
  if (!isAdmin) return null;

  // Past planned = operator already started. Don't offer publish controls.
  if (status !== "planned") return null;

  function handleUnpublish() {
    if (!confirm("Unpublish this order? It'll disappear from the floor screen so you can edit. Other published orders are unaffected.")) return;
    startTransition(async () => {
      const res = await unpublishProductionOrder(orderId);
      if (res.error) setError(res.error);
      else { setError(null); router.refresh(); }
    });
  }

  function handlePublish() {
    startTransition(async () => {
      const res = await publishProductionOrder(orderId);
      if (res.error) setError(res.error);
      else { setError(null); router.refresh(); }
    });
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
      {isPublished ? (
        <button
          onClick={handleUnpublish}
          disabled={isPending}
          style={{
            fontSize: "0.7rem", fontWeight: 700, padding: "0.2rem 0.65rem",
            borderRadius: "9999px",
            background: "#fff", color: "#dc2626", border: "1px solid #fca5a5",
            cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em",
          }}
          title="Pull this order off the floor so you can edit it. Other orders unaffected."
        >
          ✕ Unpublish
        </button>
      ) : hasProductionDate ? (
        <button
          onClick={handlePublish}
          disabled={isPending}
          style={{
            fontSize: "0.7rem", fontWeight: 700, padding: "0.2rem 0.65rem",
            borderRadius: "9999px",
            background: "#1e3a8a", color: "#fff", border: "none",
            cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em",
          }}
          title="Push this single order to the floor screen"
        >
          📤 Publish to floor
        </button>
      ) : (
        <span
          style={{
            fontSize: "0.7rem", fontWeight: 700, padding: "0.2rem 0.65rem",
            borderRadius: "9999px",
            background: "#f5f5f4", color: "#a8a29e", border: "1px solid #e7e5e4",
            textTransform: "uppercase", letterSpacing: "0.04em",
          }}
          title="Set a production date on the plan editor before publishing"
        >
          Set date to publish
        </span>
      )}
      {isPublished && (
        <span
          style={{
            fontSize: "0.7rem", fontWeight: 700, padding: "0.2rem 0.55rem",
            borderRadius: "9999px",
            background: "#dcfce7", color: "#166534",
            textTransform: "uppercase", letterSpacing: "0.04em",
          }}
          title="This order is live on the floor screen"
        >
          ● Published
        </span>
      )}
      {error && (
        <span style={{ fontSize: "0.75rem", color: "#dc2626", marginLeft: "0.4rem" }}>{error}</span>
      )}
    </span>
  );
}
