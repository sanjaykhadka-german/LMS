"use client";

/**
 * Per-department scheduler — the body of the dept modal in the plan editor.
 *
 * Layout:
 *   [Header — totals + per-dept publish action + status legend]
 *   [Container (left) | Mon..Sun calendar columns (right)]
 *
 * Behaviour:
 *   • Operator drags an order card from Container → a day column to schedule it.
 *   • Drag back to Container to un-schedule.
 *   • Drag between day columns to change the date.
 *   • UI updates OPTIMISTICALLY — the card snaps to its new bucket immediately
 *     while the server call runs in the background. If the call fails the card
 *     reverts and an error banner shows. This was the #1 source of feeling
 *     "clunky": waiting for router.refresh() before the card moved.
 *   • Published orders render as read-only (no drag handle, faded).
 *   • "Publish to floor" button sends every scheduled-but-unpublished order
 *     to the floor screen for that dept.
 *   • "Unpublish" button reverses it (only while orders are still 'planned').
 */

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { setProductionOrderDate, publishDeptOrders, unpublishDeptOrders, setOrderBatchSizing, cascadeOrderDateToConsumers, reorderOrdersInBucket, saveOverride, clearOverride, unpublishProductionOrder } from "../../actions";
import { DraggableModal } from "@/components/draggable-modal";
import OverrideModal, { type OverrideTarget } from "./override-modal";
import SplitOrderModal, { type SplitOrderTarget } from "./split-order-modal";

// Match the dept-floor-screens alias model so a dept named "Production" also
// covers any legacy "wip"-tagged orders that somehow escaped Generate.
const DEPT_ALIAS_MAP: Record<string, string[]> = {
  production: ["production", "wip"],
  filling:    ["filling", "fill", "wipf"],
  cooking:    ["cooking"],
  packing:    ["packing", "finished_good"],
  labelling:  ["labelling"],
};

export type SchedulerOrder = {
  id: string;
  batch_number: string;
  department: string | null;
  production_date: string | null;
  day_of_week: number | null;
  planned_qty: number | null;
  batch_size?: number | null;
  n_of_batches?: number | null;
  target_batch_size?: number | null;
  unit: string | null;
  status: string;
  priority: number | null;
  published_at: string | null;
  run_sequence?: number | null;
  item: { id: string; code: string; name: string; item_type: string } | null;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Build the 7 ISO date strings for the week starting at week_start (Monday). */
function weekDates(weekStart: string): string[] {
  const out: string[] = [];
  const start = new Date(weekStart + "T00:00:00Z");
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Format a number with thousands separators + 0–3 dp depending on need. */
function fmtNum(n: number | null | undefined, dp = 1): string {
  if (n == null || isNaN(Number(n))) return "—";
  const v = Number(n);
  if (Math.abs(v - Math.round(v)) < 0.05) return Math.round(v).toLocaleString("en-AU");
  return v.toLocaleString("en-AU", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

const STATUS_COLOR: Record<string, string> = {
  planned: "#f59e0b",      // orange
  in_progress: "#eab308",  // yellow
  completed: "#16a34a",    // green
  on_hold: "#a16207",      // amber
  cancelled: "#dc2626",    // red
};

// Skip-reasons — written into mrp_overrides.reason. Tino May 2026.
const SKIP_REASON_LABELS: Record<string, string> = {
  "already-in-stock":    "Already have stock — skip this run",
  "producing-elsewhere": "Producing in a different week",
  "cancelled":           "Cancelled — not making this run",
};

type SkipTarget = {
  order_id:    string;
  plan_id:     string;
  item_id:     string;
  item_code:   string;
  item_name:   string;
  department:  string;
};
type RecentSkip = { override_id: string; orderId: string; itemCode: string; itemName: string; reason: string };

export default function DeptScheduler({
  planId,
  weekStart,
  deptKey,        // 'production' | 'filling' | 'packing' | 'labelling' (lowercased)
  deptLabel,      // 'Production' | 'Filling' etc.
  orders,         // ALL production orders for the plan; we filter by dept inside
  isLocked,       // whole-plan lock state
}: {
  planId: string;
  weekStart: string;
  deptKey: string;
  deptLabel: string;
  orders: SchedulerOrder[];
  isLocked: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Local mirror of the orders prop so drag/drop can update OPTIMISTICALLY
  // without waiting for a server round-trip. Re-sync whenever the parent
  // sends fresh data (after Generate, Publish, etc.).
  const [localOrders, setLocalOrders] = useState<SchedulerOrder[]>(orders);
  useEffect(() => { setLocalOrders(orders); }, [orders]);

  // Manual MRP override modal — opens from each work-order card "✎ Override" button.
  // Materials cascade auto-recomputes from the new qty. See migration 117.
  const [overrideTarget, setOverrideTarget] = useState<OverrideTarget | null>(null);
  // Split modal — break a work order into N parts across multiple days.
  const [splitTarget, setSplitTarget] = useState<SplitOrderTarget | null>(null);

  // Skip-from-dept (override = 0) state — used by the Skip button on each
  // card. Writes mrp_overrides with qty=0 so the item disappears from this
  // dept's view for this plan, with reason audit-logged.
  const [skipTarget, setSkipTarget] = useState<SkipTarget | null>(null);
  const [skipReason, setSkipReason] = useState<string>("");
  const [skipReasonOther, setSkipReasonOther] = useState<string>("");
  const [recentSkips, setRecentSkips] = useState<RecentSkip[]>([]);
  const [showRecentSkips, setShowRecentSkips] = useState(false);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null); // 'unscheduled' | date string
  const [msg, setMsg] = useState<string | null>(null);
  // 'warn' is for "completed but with caveats" — e.g. cascade ran but some
  // downstream orders couldn't be moved because they're already finalised.
  const [msgKind, setMsgKind] = useState<"success" | "warn" | "error" | null>(null);
  // Multi-select for drag-drop (Tino, May 2026): Ctrl-click / Cmd-click
  // toggles a card in/out of the selection. Plain click clears selection
  // and just selects the clicked card. When dragging, ALL selected cards
  // move to the drop target. Selection survives across drops so the
  // operator can drag the same group to multiple days if they want.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Free-text filter — narrows the cards shown in every column to those
  // matching the item code or name. Useful in dept modals with 30+ orders
  // where Tino was scrolling looking for one specific item.
  const [orderFilter, setOrderFilter] = useState<string>("");
  // Batch-sizing modal — operator opens it from a tiny "N × M kg" indicator on
  // any card. Keeps planning view uncluttered until they need to adjust.
  const [batchEdit, setBatchEdit] = useState<SchedulerOrder | null>(null);
  const [batchEditValue, setBatchEditValue] = useState<string>("");

  // Filter the plan's orders to just this dept (case-insensitive + aliases).
  const aliases = (DEPT_ALIAS_MAP[deptKey] ?? [deptKey]).map(a => a.toLowerCase());
  const deptOrders = localOrders.filter(o =>
    o.department && aliases.includes(o.department.toLowerCase())
  );

  // Apply the operator's free-text filter on top. Doesn't change totals or
  // the underlying data — just narrows what's drawn in each column.
  const filterQ = orderFilter.trim().toLowerCase();
  const visibleOrders = filterQ
    ? deptOrders.filter(o => {
        const code = (o.item?.code ?? "").toLowerCase();
        const name = (o.item?.name ?? "").toLowerCase();
        const batch = (o.batch_number ?? "").toLowerCase();
        return code.includes(filterQ) || name.includes(filterQ) || batch.includes(filterQ);
      })
    : deptOrders;

  // Bucket orders: unscheduled (no date), or scheduled (by date).
  const unscheduled = visibleOrders.filter(o => !o.production_date);
  const days = weekDates(weekStart);
  const byDate: Record<string, SchedulerOrder[]> = Object.fromEntries(days.map(d => [d, []]));
  for (const o of visibleOrders) {
    if (o.production_date && byDate[o.production_date]) {
      byDate[o.production_date].push(o);
    } else if (o.production_date) {
      byDate[days[days.length - 1]].push(o);
    }
  }

  // Header summary totals.
  const totalOrders = deptOrders.length;
  const totalKg     = deptOrders.reduce((s, o) => s + (Number(o.planned_qty) || 0), 0);
  const publishedCount = deptOrders.filter(o => o.published_at).length;
  const scheduledUnpublishedCount = deptOrders.filter(o => o.production_date && !o.published_at).length;
  const unscheduledCount = unscheduled.length;

  // ── Drag handlers ────────────────────────────────────────────────────────
  function onDragStart(e: React.DragEvent, orderId: string) {
    if (isLocked) return;
    setDraggingId(orderId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", orderId);
  }
  function onDragOver(e: React.DragEvent, target: string) {
    if (isLocked) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (hoverTarget !== target) setHoverTarget(target);
  }
  function onDragLeave() {
    setHoverTarget(null);
  }
  function onDrop(e: React.DragEvent, target: string) {
    e.preventDefault();
    setHoverTarget(null);
    setDraggingId(null);
    if (isLocked) return;
    const draggedId = e.dataTransfer.getData("text/plain");
    if (!draggedId) return;
    const date = target === "unscheduled" ? null : target;

    // Resolve the set of orders to move. If the dragged card is part of
    // the multi-selection, drop the WHOLE selection. Otherwise just the
    // dragged card. Always include the dragged id even if the user
    // ctrl-clicked then dragged a different card (defensive).
    const idsToMove = new Set<string>();
    if (selectedIds.has(draggedId)) {
      for (const id of selectedIds) idsToMove.add(id);
    } else {
      idsToMove.add(draggedId);
    }

    // Validate each — skip published, skip no-ops. Collect actually-movable.
    const movable: string[] = [];
    let skippedPublished = 0;
    for (const id of idsToMove) {
      const o = deptOrders.find(x => x.id === id);
      if (!o) continue;
      if (o.published_at) { skippedPublished++; continue; }
      if (o.production_date === date) continue;
      movable.push(id);
    }
    if (skippedPublished > 0) {
      setMsg(`Skipped ${skippedPublished} published order${skippedPublished !== 1 ? "s" : ""} — unpublish the dept first.`);
      setMsgKind("error");
    }
    if (movable.length === 0) return;

    // OPTIMISTIC: update local state immediately so cards visually move.
    const dayOfWeek = date
      ? (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7
      : null;
    const previous = localOrders;
    setLocalOrders(prev => prev.map(o =>
      movable.includes(o.id) ? { ...o, production_date: date, day_of_week: dayOfWeek } : o
    ));

    // Fire server calls in parallel. On any error, revert local state and
    // show the FIRST error message — we don't try to roll back a partial
    // success because the optimistic state already reflects what the user
    // intended; refresh on success picks up the truth.
    startTransition(async () => {
      const results = await Promise.all(
        movable.map(id => setProductionOrderDate(id, date))
      );
      const firstErr = results.find(r => r.error);
      if (firstErr) {
        setLocalOrders(previous);
        setMsg(firstErr.error!);
        setMsgKind("error");
      } else {
        // ── Day-cascade (Tino May 2026) ──────────────────────────────────
        // For every primary order that just moved onto a date, ALSO move
        // every downstream order in the same demand chain to that date.
        // The cascade runs server-side via cascadeOrderDateToConsumers,
        // which uses the get_consumer_tree RPC (mig 093) to walk UP the
        // BOM tree from the moved item and updates production_dates of
        // every consumer order in this plan.
        //
        // Skips when date is null (drag back to "Unscheduled" lane —
        // we don't want to wipe child dates, the planner can do that
        // explicitly if intended).
        let cascadeMoved = 0;
        let cascadeSkipped = 0;
        if (date) {
          const cascadeResults = await Promise.all(
            movable.map(id => cascadeOrderDateToConsumers(id, date))
          );
          for (const r of cascadeResults) {
            cascadeMoved  += r.moved   ?? 0;
            cascadeSkipped += r.skipped ?? 0;
          }
        }

        // Friendly toast — totals across the primary moves + cascade so
        // the operator knows what just happened.
        const parts: string[] = [];
        if (movable.length > 1) parts.push(`Moved ${movable.length} orders.`);
        else                    parts.push(`Moved 1 order.`);
        if (cascadeMoved > 0)   parts.push(`Cascaded ${cascadeMoved} child order${cascadeMoved !== 1 ? "s" : ""} to the same day.`);
        if (cascadeSkipped > 0) parts.push(`(${cascadeSkipped} downstream order${cascadeSkipped !== 1 ? "s were" : " was"} already finalised — unfinalise to reschedule.)`);
        setMsg(parts.join(" "));
        setMsgKind(cascadeSkipped > 0 ? "warn" : "success");
        router.refresh();
      }
    });
  }

  // ── Per-dept publish ─────────────────────────────────────────────────────
  function publishDept() {
    if (scheduledUnpublishedCount === 0) {
      setMsg("Nothing to publish — schedule at least one order onto a day first.");
      setMsgKind("error");
      return;
    }
    const warn = unscheduledCount > 0
      ? `${unscheduledCount} ${deptLabel} order${unscheduledCount !== 1 ? "s" : ""} still in the Unscheduled column will NOT be published. Continue?`
      : `Publish ${scheduledUnpublishedCount} ${deptLabel} order${scheduledUnpublishedCount !== 1 ? "s" : ""} to the floor?`;
    if (!confirm(warn)) return;
    startTransition(async () => {
      const r = await publishDeptOrders(planId, aliases);
      if (r.error) { setMsg(r.error); setMsgKind("error"); }
      else {
        setMsg(`Published ${r.published} ${deptLabel} order${r.published !== 1 ? "s" : ""} to the floor.`);
        setMsgKind("success");
        router.refresh();
      }
    });
  }
  function unpublishDept() {
    if (publishedCount === 0) return;
    if (!confirm(`Unpublish all ${publishedCount} ${deptLabel} order${publishedCount !== 1 ? "s" : ""}? They'll disappear from the floor screen until republished.`)) return;
    startTransition(async () => {
      const r = await unpublishDeptOrders(planId, aliases);
      if (r.error) { setMsg(r.error); setMsgKind("error"); }
      else {
        setMsg(`Unpublished ${r.unpublished} ${deptLabel} order${r.unpublished !== 1 ? "s" : ""}.`);
        setMsgKind("success");
        router.refresh();
      }
    });
  }

  // ── Batch sizing ─────────────────────────────────────────────────────────
  function openBatchSizing(o: SchedulerOrder) {
    if (isLocked || o.published_at) return;
    setBatchEdit(o);
    // Per Tino's preference (May 2026): start the input EMPTY so the
    // operator can just start typing the max batch size. The value-prefill
    // was annoying — they had to highlight + delete the existing number
    // before typing. autoFocus on the input handles the cursor placement.
    setBatchEditValue("");
  }
  function closeBatchSizing() {
    setBatchEdit(null);
    setBatchEditValue("");
  }
  function saveBatchSizing() {
    if (!batchEdit) return;
    const target = batchEditValue.trim() ? Number(batchEditValue) : null;
    if (target != null && (isNaN(target) || target <= 0)) {
      setMsg("Max batch size must be a positive number, or empty for a single batch.");
      setMsgKind("error");
      return;
    }
    const orderId = batchEdit.id;
    const planned = Number(batchEdit.planned_qty) || 0;
    const nBatches = target && planned > 0 ? Math.max(1, Math.ceil(planned / target)) : 1;
    const batchSize = nBatches > 0 ? planned / nBatches : planned;
    // Optimistic update so the card refreshes immediately.
    setLocalOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, target_batch_size: target, n_of_batches: nBatches, batch_size: batchSize }
        : o
    ));
    closeBatchSizing();
    startTransition(async () => {
      const r = await setOrderBatchSizing(orderId, target);
      if (r.error) {
        setMsg(`Save failed: ${r.error}`);
        setMsgKind("error");
        // Revert by re-syncing from prop.
        setLocalOrders(orders);
      } else {
        router.refresh();
      }
    });
  }

  // ── Card render ──────────────────────────────────────────────────────────
  // Designed to fit a 1/7-of-1fr column (roughly 130–180px wide on a 1500px
  // modal). Two compact rows, no overflow. Drag handle (⋮⋮) on the left makes
  // the grab affordance obvious.
  //
  // Multi-select:
  //   • Plain click → select just this card (clears others).
  //   • Ctrl/Cmd-click → toggle this card in/out of the selection.
  //   • Drag a selected card → ALL selected cards drop on the same target.
  //   • Drag an unselected card → just that card moves; selection unchanged.
  // Drop strips between cards make the "insert here" target unambiguous —
  // each gap is its own drop zone. dropOverIdx remembers which gap is hovered
  // so we can render a red bar exactly where the card will land.
  // Format: "<bucketKey>:<index>" — bucketKey is the day or "unscheduled",
  // index is the 0-based position to insert at. -1 = no gap hovered.
  const [dropOverIdx, setDropOverIdx] = useState<string | null>(null);

  async function reorderWithinBucket(draggedId: string, insertAtIndex: number, bucket: SchedulerOrder[]) {
    const sorted = [...bucket].sort((a, b) => (a.run_sequence ?? 999) - (b.run_sequence ?? 999) || a.batch_number.localeCompare(b.batch_number));
    const dragIdx = sorted.findIndex(x => x.id === draggedId);
    if (dragIdx < 0) return;
    const next = sorted.slice();
    const [dragged] = next.splice(dragIdx, 1);
    // After removing the dragged item, the target index shifts if the target
    // was AFTER the dragged item.
    const adjusted = dragIdx < insertAtIndex ? insertAtIndex - 1 : insertAtIndex;
    next.splice(Math.max(0, Math.min(adjusted, next.length)), 0, dragged);
    const nextById = new Map(next.map((x, i) => [x.id, i + 1]));
    setLocalOrders(prev => prev.map(p => nextById.has(p.id) ? { ...p, run_sequence: nextById.get(p.id)! } : p));
    const r = await reorderOrdersInBucket(next.map(x => x.id));
    if ("error" in r) { setMsg(r.error); setMsgKind("error"); router.refresh(); }
  }

  /** A drop strip between (or above/below) cards. When dragging, hover here
   *  to insert the dragged card at this position. Renders as an 8-12px tall
   *  zone that becomes a red bar on drag-over. */
  function DropStrip({ bucketKey, index, bucket }: { bucketKey: string; index: number; bucket: SchedulerOrder[] }) {
    const stripId = `${bucketKey}:${index}`;
    const isOver = dropOverIdx === stripId;
    const isDragging = draggingId != null;
    if (!isDragging) return <div style={{ height: 4 }} />;
    const draggedInBucket = bucket.some(b => b.id === draggingId);
    if (!draggedInBucket) return <div style={{ height: 4 }} />;
    return (
      <div
        onDragOver={e => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
          if (dropOverIdx !== stripId) setDropOverIdx(stripId);
        }}
        onDragLeave={() => { if (dropOverIdx === stripId) setDropOverIdx(null); }}
        onDrop={e => {
          e.preventDefault();
          e.stopPropagation();
          const dragged = draggingId;
          setDropOverIdx(null);
          setDraggingId(null);
          if (dragged) reorderWithinBucket(dragged, index, bucket);
        }}
        style={{
          height: isOver ? 14 : 8,
          margin: "1px 0",
          borderRadius: 3,
          background: isOver ? "#dc2626" : "transparent",
          border: isOver ? "1px solid #b91c1c" : "1px dashed #cfc9bf",
          opacity: isOver ? 1 : 0.4,
          transition: "all 0.08s",
        }}
      />
    );
  }

  function OrderCard({ o, bucket }: { o: SchedulerOrder; bucket: SchedulerOrder[] }) {
    void bucket; // reserved for future bucket-aware styling
    const isPublished = !!o.published_at;
    const draggable = !isLocked && !isPublished && o.status === "planned";
    const statusColor = STATUS_COLOR[o.status] ?? "#a8a29e";
    const isSelected = selectedIds.has(o.id);
    // Card layout mirrors the machine-view (run-order-board.tsx) card so the
    // planner has a single mental model: priority dot + code top-left, run
    // sequence / lock pill top-right, name, batch-number + qty row, batch-
    // sizing chip, and two action buttons at the bottom. Override + Split
    // replace the machine view's ↑/↓ buttons (calendar reordering happens via
    // drag, not buttons), but use the same neutral grey-button styling so the
    // visual weight matches.
    return (
      <div
        draggable={draggable}
        onDragStart={e => onDragStart(e, o.id)}
        onDragEnd={() => { setDraggingId(null); setDropOverIdx(null); }}
        onClick={e => {
          if (!draggable) return;
          if (e.ctrlKey || e.metaKey) {
            setSelectedIds(prev => {
              const next = new Set(prev);
              if (next.has(o.id)) next.delete(o.id); else next.add(o.id);
              return next;
            });
          } else {
            setSelectedIds(prev => {
              if (prev.size === 1 && prev.has(o.id)) return new Set();
              return new Set([o.id]);
            });
          }
        }}
        title={`${o.item?.name ?? ""} · ${o.batch_number} · ${o.status}${isPublished ? ` · published ${new Date(o.published_at!).toLocaleDateString()}` : ""}\nCtrl-click to add to selection · Plain click to select only this`}
        style={{
          background: isPublished ? "#fafaf9" : isSelected ? "#fef3c7" : "#fff",
          border: `1px solid ${isSelected ? "#f59e0b" : isPublished ? "#a8a29e" : "#e7e5e4"}`,
          borderStyle: isPublished ? "dashed" : "solid",
          borderRadius: "0.375rem",
          padding: "0.5rem 0.625rem",
          marginBottom: "0.3rem",
          cursor: draggable ? (draggingId === o.id ? "grabbing" : "pointer") : "default",
          opacity: draggingId === o.id ? 0.4 : (isPublished ? 0.85 : 1),
          boxShadow: isSelected
            ? "0 0 0 2px rgba(245,158,11,0.35)"
            : draggingId === o.id ? "none" : "0 1px 2px rgba(0,0,0,0.04)",
          backgroundImage: isPublished
            ? "repeating-linear-gradient(45deg, transparent 0 6px, rgba(168,162,158,0.08) 6px 12px)"
            : undefined,
          userSelect: "none",
          transition: "opacity 0.1s, box-shadow 0.1s, background 0.1s",
        }}
      >
        {/* Top row: priority dot + code (left) · status pill (right) */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: statusColor, flexShrink: 0 }} title={`Status: ${o.status}`} />
              <span style={{ fontFamily: "monospace", fontWeight: 600, fontSize: "0.8125rem", color: "#1c1917", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {o.item?.code ?? "?"}
              </span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "#1c1917", fontWeight: 500, marginTop: "0.15rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {o.item?.name ?? "—"}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.2rem", flexShrink: 0 }}>
            {isPublished && (
              <span style={{ fontSize: "0.6rem", background: "#dcfce7", color: "#166534", padding: "0.05rem 0.35rem", borderRadius: "999px", fontWeight: 700 }} title="Published to the floor">
                ✓ Published
              </span>
            )}
          </div>
        </div>
        {/* Mid row: batch number (left) · qty (right) */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.375rem", fontSize: "0.7rem", color: "#57534e" }}>
          <span style={{ fontFamily: "monospace" }}>{o.batch_number}</span>
          <span style={{ fontWeight: 700, color: "#166534", fontSize: "0.8rem" }}>
            {fmtNum(o.planned_qty)}{o.unit ? ` ${o.unit}` : ""}
          </span>
        </div>
        {/* Batch-sizing chip — same blue-pill styling as machine card. */}
        <div
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); if (!isLocked && !isPublished) openBatchSizing(o); }}
          style={{
            marginTop: "0.4rem",
            padding: "0.25rem 0.5rem",
            background: !isLocked && !isPublished ? "#dbeafe" : "transparent",
            border: !isLocked && !isPublished ? "1px solid #93c5fd" : "1px solid #e7e5e4",
            color: !isLocked && !isPublished ? "#1e3a8a" : "#a8a29e",
            borderRadius: "0.3rem",
            fontFamily: "monospace", fontWeight: 600,
            fontSize: "0.7rem",
            cursor: !isLocked && !isPublished ? "pointer" : "default",
            display: "inline-block",
            opacity: !isLocked && !isPublished ? 1 : 0.6,
          }}
          title={!isLocked && !isPublished ? "Click to set max batch size" : "Batch sizing locked"}
        >
          {(o.n_of_batches ?? 1) > 1
            ? `⚙ ${o.n_of_batches} × ${fmtNum(o.batch_size)} ${o.unit ?? ""}`
            : `⚙ 1 batch · set sizing`}
        </div>
        {/* Action row — Override + Split. Same row layout as machine view's
            ↑/↓ buttons so the two cards feel identical to operators. */}
        {!isLocked && !isPublished && o.item && (
          <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.4rem" }}>
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation();
                setOverrideTarget({
                  plan_id:    planId,
                  item_id:    o.item!.id,
                  item_code:  o.item!.code,
                  item_name:  o.item!.name,
                  department: o.department ?? deptLabel,
                  current_qty: Number(o.planned_qty ?? 0),
                  unit:       o.unit ?? "kg",
                });
              }}
              title="Manually override the planned qty — materials downstream recompute from the new qty."
              style={{
                flex: 1, padding: "0.3rem 0",
                border: "1px solid #d6d3d1",
                background: "white",
                color: "#854d0e",
                borderRadius: "0.25rem",
                cursor: "pointer",
                fontSize: "0.72rem",
                fontFamily: "inherit",
                lineHeight: 1,
                fontWeight: 600,
              }}
            >✎ Override</button>
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation();
                setSplitTarget({
                  order_id:    o.id,
                  item_code:   o.item!.code,
                  item_name:   o.item!.name,
                  department:  o.department ?? deptLabel,
                  current_qty: Number(o.planned_qty ?? 0),
                  unit:        o.unit ?? "kg",
                  current_date: o.production_date,
                  week_dates:  weekDates(weekStart),
                });
              }}
              title="Split this work order into multiple days for JIT production."
              style={{
                flex: 1, padding: "0.3rem 0",
                border: "1px solid #d6d3d1",
                background: "white",
                color: "#1e3a8a",
                borderRadius: "0.25rem",
                cursor: "pointer",
                fontSize: "0.72rem",
                fontFamily: "inherit",
                lineHeight: 1,
                fontWeight: 600,
              }}
            >✂ Split</button>
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); handleSkipOpen(o); }}
              title="Skip this item from this dept for the current plan (override = 0, audit logged). Undoable."
              style={{
                flex: 1, padding: "0.3rem 0",
                border: "1px dashed #d6d3d1",
                background: "transparent",
                color: "#78716c",
                borderRadius: "0.25rem",
                cursor: "pointer",
                fontSize: "0.72rem",
                fontFamily: "inherit",
                lineHeight: 1,
                fontWeight: 600,
              }}
            >✕ Skip</button>
          </div>
        )}
        {/* Per-order Unpublish on a published card — lets the planner edit one
            order without unfinalising the whole day. */}
        {isPublished && !isLocked && (
          <div style={{ display: "flex", marginTop: "0.4rem" }}>
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); handleUnpublishOne(o); }}
              title="Unpublish just this order so it can be edited or moved. Day-level publish stays intact."
              style={{
                flex: 1, padding: "0.3rem 0",
                background: "#fef2f2",
                border: "1px solid #fca5a5",
                color: "#991b1b",
                borderRadius: "0.25rem",
                cursor: "pointer",
                fontSize: "0.7rem",
                fontWeight: 600,
                fontFamily: "inherit",
              }}
            >✕ Unpublish this order</button>
          </div>
        )}
      </div>
    );
  }

  function DropZone({
    target, label, sub, orders: orderList, accent, dense,
  }: {
    target: string; label: string; sub?: string; orders: SchedulerOrder[]; accent: string; dense?: boolean;
  }) {
    const isHover = hoverTarget === target;
    const totalKgInZone = orderList.reduce((s, o) => s + (Number(o.planned_qty) || 0), 0);
    return (
      <div
        onDragOver={e => onDragOver(e, target)}
        onDragLeave={onDragLeave}
        onDrop={e => onDrop(e, target)}
        style={{
          flex: 1, minWidth: 0,
          padding: dense ? "0.4rem" : "0.5rem",
          background: isHover ? "#fef2f2" : "#fafaf9",
          border: `1px dashed ${isHover ? "#dc2626" : "#d6d3d1"}`,
          borderRadius: "0.5rem",
          minHeight: "180px",
          display: "flex", flexDirection: "column",
          transition: "background 0.1s, border-color 0.1s",
        }}
      >
        <div style={{ marginBottom: "0.35rem", borderBottom: `2px solid ${accent}`, paddingBottom: "0.25rem" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {label}
          </div>
          {sub && (
            <div style={{ fontSize: "0.6rem", color: "#78716c", marginTop: "0.1rem" }}>{sub}</div>
          )}
          <div style={{ fontSize: "0.6rem", color: "#78716c", marginTop: "0.05rem" }}>
            {orderList.length} · {fmtNum(totalKgInZone)} kg
          </div>
        </div>
        {orderList.length === 0 ? (
          <div style={{ fontSize: "0.65rem", color: "#a8a29e", textAlign: "center", padding: "0.5rem", fontStyle: "italic" }}>
            {isHover ? "Drop here" : "—"}
          </div>
        ) : (
          <>
            <DropStrip bucketKey={target} index={0} bucket={orderList} />
            {orderList.map((o, i) => (
              <div key={o.id}>
                <OrderCard o={o} bucket={orderList} />
                <DropStrip bucketKey={target} index={i + 1} bucket={orderList} />
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  // No work orders for this dept yet — common right after Run MRP, before
  // Generate Orders has fired. Without this banner the operator just sees an
  // empty Unscheduled column and assumes the system is broken.
  const hasNoOrders = deptOrders.length === 0;

  function handleSkipOpen(o: SchedulerOrder) {
    if (!o.item) return;
    setSkipTarget({
      order_id:   o.id,
      plan_id:    planId,
      item_id:    o.item.id,
      item_code:  o.item.code,
      item_name:  o.item.name,
      department: o.department ?? deptLabel,
    });
    setSkipReason("already-in-stock");
    setSkipReasonOther("");
  }
  function handleSkipCancel() {
    setSkipTarget(null);
    setSkipReason("");
    setSkipReasonOther("");
  }
  function handleSkipSave() {
    if (!skipTarget) return;
    const reasonLabel = skipReason === "other"
      ? skipReasonOther.trim()
      : SKIP_REASON_LABELS[skipReason] ?? skipReason;
    if (!reasonLabel || reasonLabel.length < 3) {
      setMsg("Reason is required (min 3 chars).");
      setMsgKind("error");
      return;
    }
    const orderId = skipTarget.order_id;
    const itemId = skipTarget.item_id;
    const itemCode = skipTarget.item_code;
    const itemName = skipTarget.item_name;
    const dept = skipTarget.department;
    const snapshot = localOrders;
    setLocalOrders(prev => prev.filter(o => o.id !== orderId));
    setSkipTarget(null);
    setSkipReason("");
    setSkipReasonOther("");
    startTransition(async () => {
      const r = await saveOverride({
        plan_id: skipTarget.plan_id,
        item_id: itemId,
        department: dept,
        override_qty: 0,
        reason: reasonLabel,
      });
      if ("error" in r) {
        setMsg(r.error);
        setMsgKind("error");
        setLocalOrders(snapshot); // rollback
        return;
      }
      setRecentSkips(prev => [{ override_id: r.id, orderId, itemCode, itemName, reason: reasonLabel }, ...prev]);
      router.refresh();
    });
  }
  function handleUndoSkip(skip: RecentSkip) {
    setRecentSkips(prev => prev.filter(s => s.override_id !== skip.override_id));
    startTransition(async () => {
      const r = await clearOverride({ override_id: skip.override_id, resolved_note: "Undone from dept scheduler" });
      if ("error" in r) {
        setMsg(r.error);
        setMsgKind("error");
        setRecentSkips(prev => [skip, ...prev]);
        return;
      }
      router.refresh();
    });
  }

  // Per-order Unpublish — flips published_at to null on a single order so
  // the planner can edit one card without unfinalising the whole day.
  function handleUnpublishOne(o: SchedulerOrder) {
    const orderId = o.id;
    const snapshot = localOrders;
    setLocalOrders(prev => prev.map(x => x.id === orderId ? { ...x, published_at: null } : x));
    startTransition(async () => {
      const r = await unpublishProductionOrder(orderId);
      if (r.error) {
        setMsg(r.error);
        setMsgKind("error");
        setLocalOrders(snapshot);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", minHeight: "500px" }}>
      {/* Recent skips — appears after at least one skip this session. */}
      {recentSkips.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: "0.5rem",
          padding: "0.5rem 0.75rem",
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: "0.375rem",
          fontSize: "0.75rem",
          flexWrap: "wrap",
        }}>
          <span style={{ fontWeight: 600, color: "#92400e" }}>
            {recentSkips.length} skipped this session
          </span>
          <button
            type="button"
            onClick={() => setShowRecentSkips(v => !v)}
            style={{ background: "none", border: "none", color: "#b45309", cursor: "pointer", textDecoration: "underline", fontSize: "0.75rem", padding: 0 }}
          >
            {showRecentSkips ? "Hide" : "Show / Undo"}
          </button>
          {showRecentSkips && recentSkips.map(skip => (
            <span key={skip.override_id} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.15rem 0.5rem", background: "#fff", border: "1px solid #fde68a", borderRadius: "999px" }}>
              <span style={{ fontFamily: "monospace", color: "#78716c" }}>{skip.itemCode}</span>
              <span style={{ color: "#1c1917" }}>{skip.itemName}</span>
              <span style={{ color: "#a8a29e", fontStyle: "italic" }}>· {skip.reason}</span>
              <button
                type="button"
                onClick={() => handleUndoSkip(skip)}
                title="Undo skip — restores the item to this dept's view"
                style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer", fontWeight: 700, fontSize: "0.7rem", padding: 0, marginLeft: "0.15rem" }}
              >↺ Undo</button>
            </span>
          ))}
        </div>
      )}
      {hasNoOrders && (
        <div style={{
          padding: "0.75rem 1rem", background: "#fef3c7", border: "1px solid #fcd34d",
          borderRadius: "0.5rem", fontSize: "0.8125rem", color: "#854d0e",
          display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap",
        }}>
          <span style={{ fontSize: "1rem" }}>💡</span>
          <span style={{ flex: 1 }}>
            <strong>No work orders yet for {deptLabel}.</strong>{" "}
            MRP has calculated what&apos;s needed (top of this modal), but the
            tracked work orders haven&apos;t been created yet. Click{" "}
            <strong>✅ Generate Production Orders</strong> at the top of the
            modal to create them — they&apos;ll appear in the{" "}
            <strong>Unscheduled</strong> column below, ready to drag onto a day.
          </span>
        </div>
      )}

      {/* Multi-select helper — only when 2+ selected. Shows the count and a
          quick clear so the operator knows the next drag is a multi-drop. */}
      {selectedIds.size > 1 && (
        <div style={{
          padding: "0.45rem 0.75rem", background: "#fef3c7", border: "1px solid #f59e0b",
          borderRadius: "0.375rem", fontSize: "0.75rem", color: "#854d0e",
          display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap",
        }}>
          <span style={{ fontSize: "0.95rem" }}>📌</span>
          <span style={{ flex: 1 }}>
            <strong>{selectedIds.size} orders selected.</strong> Drag any one of
            them onto a day → all of them move together.
          </span>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            style={{ background: "none", border: "none", color: "#854d0e", cursor: "pointer", fontSize: "0.7rem", padding: "0.15rem 0.4rem", textDecoration: "underline" }}
          >Clear selection</button>
        </div>
      )}

      {/* Filter input — narrows what's drawn in every column. Doesn't touch
          the totals (they stay at the dept-wide level) so the operator sees
          "show me the chorizo cards" without losing the bigger picture. */}
      <div style={{
        display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap",
        padding: "0.4rem 0.75rem", background: "#fff",
        border: "1px solid #f5f5f4", borderRadius: "0.375rem",
      }}>
        <input
          type="text"
          value={orderFilter}
          onChange={e => setOrderFilter(e.target.value)}
          placeholder="🔎 Filter orders by code, name or batch number…"
          className="form-input"
          style={{ fontSize: "0.8125rem", padding: "0.3rem 0.55rem", flex: 1, maxWidth: "26rem" }}
        />
        {orderFilter && (
          <>
            <span style={{ fontSize: "0.7rem", color: "#78716c" }}>
              {visibleOrders.length} of {deptOrders.length}
            </span>
            <button
              type="button"
              onClick={() => setOrderFilter("")}
              style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "0.7rem", padding: "0.2rem 0.4rem" }}
              title="Clear filter"
            >✕</button>
          </>
        )}
      </div>

      {/* ── Summary header ──────────────────────────────────────────────── */}
      <div style={{
        padding: "0.6rem 0.875rem", background: "#fafaf9", border: "1px solid #e7e5e4",
        borderRadius: "0.5rem",
        display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap" }}>
          <Stat label="Total" value={`${totalOrders} order${totalOrders !== 1 ? "s" : ""}`} />
          <Stat label="Total qty" value={`${fmtNum(totalKg)} kg`} />
          <Stat label="Unscheduled" value={String(unscheduledCount)}
            color={unscheduledCount > 0 ? "#b91c1c" : "#78716c"} />
          <Stat label="Scheduled · unpublished" value={String(scheduledUnpublishedCount)}
            color={scheduledUnpublishedCount > 0 ? "#854d0e" : "#78716c"} />
          <Stat label="Published" value={String(publishedCount)}
            color={publishedCount > 0 ? "#166534" : "#78716c"} />
        </div>
        {/* Finalise (publish) and unpublish moved to the Run Order page —
            Tino May 2026. The planner flow is now linear:
              Day-grid here → Schedule Machines → Finalise on that page.
            Keeps Publish out of sight until machines have been assigned. */}
        <div style={{ marginLeft: "auto", fontSize: "0.75rem", color: "#78716c" }}>
          {scheduledUnpublishedCount > 0
            ? `${scheduledUnpublishedCount} ready to schedule onto machines →`
            : publishedCount > 0
              ? `${publishedCount} finalised on the floor`
              : null}
        </div>
      </div>

      {/* Status-dot legend — explains the colored left-stripe on every card. */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: "0.875rem", alignItems: "center",
        fontSize: "0.7rem", color: "#57534e",
        padding: "0.4rem 0.75rem", background: "#fff",
        border: "1px solid #f5f5f4", borderRadius: "0.375rem",
      }}>
        <span style={{ fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</span>
        {([
          ["planned", "Planned"],
          ["in_progress", "In progress"],
          ["completed", "Completed"],
          ["on_hold", "On hold"],
          ["cancelled", "Cancelled"],
        ] as const).map(([k, label]) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
            <span style={{ display: "inline-block", width: "0.7rem", height: "0.7rem", borderRadius: "0.15rem", background: STATUS_COLOR[k] }} />
            {label}
          </span>
        ))}
        <span style={{ marginLeft: "auto", fontStyle: "italic", color: "#a8a29e" }}>
          Grab the <span style={{ fontFamily: "monospace", color: "#57534e", fontWeight: 700 }}>⋮⋮</span> handle and drop onto a day.
        </span>
      </div>

      {msg && (
        <div style={{
          padding: "0.5rem 0.875rem",
          background: msgKind === "error" ? "#fef2f2" : msgKind === "warn" ? "#fefce8" : "#f0fdf4",
          border: `1px solid ${msgKind === "error" ? "#fca5a5" : msgKind === "warn" ? "#fde047" : "#86efac"}`,
          borderRadius: "0.375rem",
          fontSize: "0.8125rem",
          color: msgKind === "error" ? "#991b1b" : msgKind === "warn" ? "#854d0e" : "#166534",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>{msg}</span>
          <button onClick={() => setMsg(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: "1rem", padding: 0, marginLeft: "0.5rem" }}>×</button>
        </div>
      )}

      {/* ── Container (left) + Mon–Sun calendar (right) ─────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: "0.5rem", flex: 1, minHeight: 0 }}>
        {/* Unscheduled container */}
        <DropZone target="unscheduled" label="Unscheduled" sub="Drag onto a day →" orders={unscheduled} accent="#dc2626" />

        {/* Mon–Sun calendar */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0.4rem", minWidth: 0 }}>
          {days.map((date, i) => {
            return (
              <DropZone
                key={date}
                target={date}
                label={DAY_LABELS[i]}
                sub={`${date.slice(8, 10)}/${date.slice(5, 7)}`}
                orders={byDate[date]}
                accent="#1e3a8a"
                dense
              />
            );
          })}
        </div>
      </div>

      {/* ── Batch-sizing modal ──────────────────────────────────────────── */}
      {batchEdit && (() => {
        const planned = Number(batchEdit.planned_qty) || 0;
        const target = Number(batchEditValue) || 0;
        const computedN = target > 0 && planned > 0 ? Math.max(1, Math.ceil(planned / target)) : 1;
        const computedSize = computedN > 0 ? planned / computedN : planned;
        return (
          <DraggableModal
            title={`⚙️ Batch sizing — ${batchEdit.item?.code ?? ""} ${batchEdit.item?.name ?? ""}`}
            subtitle={<>Total to produce: <strong>{fmtNum(planned)} {batchEdit.unit ?? ""}</strong></>}
            accent="#854d0e"
            onClose={closeBatchSizing}
            width={520}
            footer={
              <>
                <button type="button" onClick={closeBatchSizing} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Cancel</button>
                <button type="button" onClick={saveBatchSizing} disabled={isPending} className="btn-primary" style={{ fontSize: "0.8125rem" }}>
                  {isPending ? "Saving…" : "💾 Save sizing"}
                </button>
              </>
            }
          >
            <p style={{ fontSize: "0.8125rem", color: "#57534e", marginTop: 0 }}>
              Set the <strong>maximum size of a single batch</strong> (e.g. mixer capacity). The system divides the total
              evenly across that many batches. Leave blank for one big batch.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem" }}>
              <div>
                <label className="form-label">Max batch size ({batchEdit.unit ?? "kg"})</label>
                <input
                  type="number" step="0.01" min={0}
                  value={batchEditValue}
                  onChange={e => setBatchEditValue(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveBatchSizing(); } }}
                  className="form-input"
                  autoFocus
                  placeholder={batchEdit.target_batch_size != null
                    ? `Previously ${batchEdit.target_batch_size}`
                    : `e.g. 1000`}
                />
              </div>
              <div>
                <label className="form-label">Total to produce</label>
                <input
                  className="form-input"
                  value={`${fmtNum(planned)} ${batchEdit.unit ?? ""}`}
                  disabled
                  style={{ background: "#fafaf9", color: "#78716c" }}
                />
              </div>
            </div>
            <div style={{ marginTop: "0.75rem", padding: "0.625rem 0.875rem", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "0.375rem", fontSize: "0.8125rem", color: "#854d0e", display: "flex", justifyContent: "space-between" }}>
              <span>Resulting split:</span>
              <strong>{computedN} x {fmtNum(computedSize)} {batchEdit.unit ?? ""}</strong>
            </div>
          </DraggableModal>
        );
      })()}
          {/* Manual MRP override modal — see migration 117 + override-modal.tsx */}
      {overrideTarget && (
        <OverrideModal
          target={overrideTarget}
          onClose={() => { setOverrideTarget(null); router.refresh(); }}
        />
      )}

      {/* Split-order modal — separate concern from override; deletes original
          and creates N new work orders. Materials cascade per-date via RPC. */}
      {splitTarget && (
        <SplitOrderModal
          target={splitTarget}
          onClose={() => { setSplitTarget(null); router.refresh(); }}
        />
      )}

      {/* Skip-from-dept modal — captures the audit-trail reason then writes
          mrp_overrides with override_qty=0 (item disappears from this dept's
          view for this plan). Undoable via the chip at the top. */}
      {skipTarget && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 50,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "1.5rem",
          }}
          onMouseDown={e => { if (e.target === e.currentTarget) handleSkipCancel(); }}
        >
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: "0.625rem",
              width: "min(480px, 100%)",
              padding: "1.25rem 1.5rem",
              boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            }}
          >
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem", fontWeight: 700 }}>
              Skip from this dept
            </h3>
            <p style={{ margin: "0 0 1rem", fontSize: "0.8125rem", color: "#57534e", lineHeight: 1.4 }}>
              Remove <strong>{skipTarget.item_code} — {skipTarget.item_name}</strong> from <strong>{skipTarget.department}</strong> for this plan.
              An audit row is written to <code style={{ fontSize: "0.7rem", background: "#f5f5f4", padding: "0.05rem 0.25rem", borderRadius: "0.2rem" }}>mrp_overrides</code> (override_qty = 0).
              Undoable from the chip at the top.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.75rem" }}>
              {Object.entries(SKIP_REASON_LABELS).map(([key, label]) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="dept-skip-reason"
                    value={key}
                    checked={skipReason === key}
                    onChange={() => setSkipReason(key)}
                  />
                  {label}
                </label>
              ))}
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="dept-skip-reason"
                  value="other"
                  checked={skipReason === "other"}
                  onChange={() => setSkipReason("other")}
                />
                Other:
              </label>
              {skipReason === "other" && (
                <input
                  type="text"
                  autoFocus
                  className="form-input"
                  placeholder="Reason (will be audit-logged)"
                  value={skipReasonOther}
                  onChange={e => setSkipReasonOther(e.target.value)}
                  style={{ marginLeft: "1.5rem", fontSize: "0.8125rem" }}
                />
              )}
            </div>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button type="button" onClick={handleSkipCancel} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
                Cancel
              </button>
              <button type="button" onClick={handleSkipSave} disabled={isPending} className="btn-primary" style={{ fontSize: "0.8125rem" }}>
                {isPending ? "Saving…" : "Skip from this dept"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function Stat({ label, value, color = "#1c1917" }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: "0.6rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "0.95rem", fontWeight: 700, color, marginTop: "0.05rem" }}>{value}</div>
    </div>
  );
}
