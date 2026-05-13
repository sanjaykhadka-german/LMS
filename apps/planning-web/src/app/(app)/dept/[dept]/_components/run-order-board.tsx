"use client";

/**
 * Per-machine run-order board.
 *
 * Layout:
 *   [Day chips: Mon | Tue | Wed | Thu | Fri | Sat | Sun]
 *   [Column: Unassigned] [Column: Machine A] [Column: Machine B] ...
 *
 * Card = one production_order. Drag between columns to assign machine_id.
 * Drag within a column to set run_sequence (1-indexed). Both actions persist
 * via the dept/actions.ts server actions.
 *
 * HTML5 drag-and-drop (no libraries). The DataTransfer object carries the
 * order id; the drop target captures column id (machine_id-or-null) and the
 * intended index. We optimistically reorder the local state so the board
 * never feels laggy, then reconcile via router.refresh() after the server
 * action returns.
 */

import { useState, useMemo, useEffect, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { assignProductionOrderToMachine, reorderMachineQueue } from "../../actions";
// Finalise / Unfinalise buttons on this page wrap the same publish actions
// the dept-scheduler used to call — moved here in the May-2026 UX rework so
// the planner flow is linear: schedule day → schedule machines → finalise.
import { publishDeptOrders, unpublishDeptOrders, publishDeptOrdersForDay, unpublishDeptOrdersForDay, setProductionOrderDate, setOrderBatchSizing, unpublishProductionOrder, saveOverride, clearOverride } from "@/app/(app)/plans/actions";
import WorkOrderModal from "@/components/work-order-modal";
import { DraggableModal } from "@/components/draggable-modal";

// Preset skip reasons — written into mrp_overrides.reason. We keep them
// short and audit-friendly. "Other" lets the user type a custom reason.
const SKIP_REASON_LABELS: Record<string, string> = {
  "already-in-stock":   "Already have stock — skip this run",
  "producing-elsewhere": "Producing in a different week",
  "cancelled":          "Cancelled — not making this run",
};

type Machine = {
  id: string;
  name: string;
  code: string | null;
  machine_type: string | null;
  status: string;
  capacity_value: number | null;
  capacity_unit: string | null;
  department_id: string | null;
};

type Order = {
  id: string;
  batch_number: string;
  production_date: string | null;
  day_of_week: number | null;
  planned_qty: number;
  unit: string;
  status: string;
  priority: number;
  machine_id: string | null;
  run_sequence: number | null;
  batch_size: number | null;
  n_of_batches: number | null;
  target_batch_size: number | null;
  machine: string | null;
  department: string;
  /** When set, the order is committed to the floor — operators are looking
   *  at it. Run-order changes are blocked server-side and the card renders
   *  with a 🔒 indicator on the board. Unpublish via the work-order page or
   *  per-dept Unpublish to edit. */
  published_at?: string | null;
  item: { id: string; code: string; name: string } | null;
};

const DAYS_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Format kg/units compactly for the card. */
function fmt(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return "—";
  const v = Number(n);
  if (Math.abs(v - Math.round(v)) < 0.05) return Math.round(v).toLocaleString("en-AU");
  return v.toLocaleString("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** ISO Monday + offset (0=Mon … 6=Sun) → ISO day string. */
function dayOfWeek(monday: string, offset: number): string {
  const d = new Date(monday + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** ISO date → Mon/Tue label without timezone drift. */
function dayLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  return `${DAYS_SHORT[dow]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export default function RunOrderBoard({
  deptSlug,
  weekStart,
  initialDay,
  machines,
  orders,
  planId,
  deptAliases,
}: {
  deptSlug: string;
  weekStart: string;
  initialDay: string;
  machines: Machine[];
  orders: Order[];
  /** Demand plan id for the current week — required by the Finalise /
   *  Unfinalise actions. NULL when the week has no plan yet (controls
   *  hide). */
  planId: string | null;
  /** Dept name variants accepted by publishDeptOrders (e.g.
   *  ["filling","Filling","FILLING","wipf"]). Computed in the page. */
  deptAliases: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [selectedDay, setSelectedDayState] = useState<string>(initialDay);

  // Pick a day. We mirror the choice into the URL (?day=YYYY-MM-DD) so that
  // router.refresh() — called after Approve / Finalise / Unfinalise — re-reads
  // the same day from searchParams and doesn't snap back to Monday. Uses
  // router.replace so the change doesn't pile up in browser history.
  function setSelectedDay(iso: string) {
    setSelectedDayState(iso);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("day", iso);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }
  const [error, setError] = useState<string | null>(null);

  // Local mirror of orders so optimistic updates land instantly. The server
  // is the source of truth — we router.refresh() after each persisted change
  // so any concurrent edits surface promptly.
  const [localOrders, setLocalOrders] = useState<Order[]>(orders);

  // Sync localOrders when the orders prop changes (e.g. after router.refresh()
  // re-fetches server data). Without this useEffect, the optimistic local
  // state would never reconcile with concurrent edits or post-save server
  // recalculations. Tino May 2026.
  useEffect(() => { setLocalOrders(orders); }, [orders]);

  // ── Skip-via-override state ─────────────────────────────────────────
  // Skipping an item from this dept's view writes an mrp_overrides row with
  // qty=0 — the item disappears from the cascade for this plan/dept until
  // the override is cleared. Audit trail preserved (reason + who/when).
  type RecentSkip = { override_id: string; orderId: string; itemCode: string; itemName: string; reason: string };
  const [skipOrder, setSkipOrder] = useState<Order | null>(null);
  const [skipReason, setSkipReason] = useState<string>("");
  const [skipReasonOther, setSkipReasonOther] = useState<string>("");
  const [recentSkips, setRecentSkips] = useState<RecentSkip[]>([]);
  const [showRecentSkips, setShowRecentSkips] = useState(false);

  // Drag state (id of the order being dragged + the column it came from, so
  // we can render a "ghosted" placeholder in the source column).
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ col: string; index: number } | null>(null);
  // Day chip drop target — set while a card is being dragged over a day chip
  // (or "__holding"). Used for visual hover state + the drop handler.
  const [dayDropTarget, setDayDropTarget] = useState<string | null>(null);
  const [batchEditOrder, setBatchEditOrder] = useState<Order | null>(null);
  const [batchEditValue, setBatchEditValue] = useState<string>("");

  async function handleSaveBatchSize() {
    if (!batchEditOrder) return;
    const target = batchEditValue.trim() === "" ? null : Number(batchEditValue);
    if (target != null && (Number.isNaN(target) || target < 0)) {
      setError("Batch size must be a positive number or blank for one big batch.");
      return;
    }
    const orderId = batchEditOrder.id;
    setBatchEditOrder(null);
    startTransition(async () => {
      const r = await setOrderBatchSizing(orderId, target);
      if (r.error) { setError(r.error); return; }
      router.refresh();
    });
  }

  // Per-order unpublish — flips published_at to null on a single order
  // (existing unpublishProductionOrder server action). Optimistic: card
  // becomes unlocked immediately; on error we roll back.
  function handleUnpublishOne(order: Order) {
    const canActLocal = !!planId && deptAliases.length > 0;
    if (!canActLocal) return;
    const original = order.published_at;
    setLocalOrders(prev => prev.map(o => o.id === order.id ? { ...o, published_at: null } : o));
    startTransition(async () => {
      const r = await unpublishProductionOrder(order.id);
      if (r.error) {
        setError(r.error);
        // Rollback
        setLocalOrders(prev => prev.map(o => o.id === order.id ? { ...o, published_at: original } : o));
        return;
      }
      router.refresh();
    });
  }

  // ── Skip flow ──────────────────────────────────────────────────────
  function handleSkipOpen(order: Order) {
    const canActLocal = !!planId && deptAliases.length > 0;
    if (!canActLocal || !planId) return;
    setSkipOrder(order);
    setSkipReason("already-in-stock");
    setSkipReasonOther("");
  }
  function handleSkipCancel() {
    setSkipOrder(null);
    setSkipReason("");
    setSkipReasonOther("");
  }
  function handleSkipSave() {
    if (!skipOrder || !planId || !skipOrder.item) return;
    const reasonLabel = skipReason === "other"
      ? skipReasonOther.trim()
      : SKIP_REASON_LABELS[skipReason] ?? skipReason;
    if (!reasonLabel || reasonLabel.length < 3) {
      setError("Reason is required (min 3 chars).");
      return;
    }
    // Optimistic — remove the order from the board immediately. We use the
    // department on the order so we override that specific dept's row.
    const orderId = skipOrder.id;
    const itemId = skipOrder.item.id;
    const itemCode = skipOrder.item.code ?? "—";
    const itemName = skipOrder.item.name ?? "—";
    const dept = skipOrder.department ?? deptAliases[0] ?? deptSlug;
    const snapshot = localOrders;
    setLocalOrders(prev => prev.filter(o => o.id !== orderId));
    setSkipOrder(null);
    setSkipReason("");
    setSkipReasonOther("");
    startTransition(async () => {
      const r = await saveOverride({
        plan_id: planId,
        item_id: itemId,
        department: dept,
        override_qty: 0,
        reason: reasonLabel,
      });
      if ("error" in r) {
        setError(r.error);
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
      const r = await clearOverride({ override_id: skip.override_id, resolved_note: "Undone from run-order board" });
      if ("error" in r) {
        setError(r.error);
        // Put it back into the chip
        setRecentSkips(prev => [skip, ...prev]);
        return;
      }
      router.refresh();
    });
  }

  // Reschedule a card to a different day (or "Holding" = null date).
  // Optimistic update + persist via setProductionOrderDate.
  function handleRescheduleToDay(orderId: string, isoDate: string | null) {
    const order = localOrders.find(o => o.id === orderId);
    if (!order) return;
    if (order.production_date === isoDate) return;
    setLocalOrders(prev => prev.map(o => o.id === orderId
      ? { ...o, production_date: isoDate, day_of_week: isoDate ? dayIdxFromIso(isoDate) : null }
      : o));
    startTransition(async () => {
      try {
        const res = await setProductionOrderDate(orderId, isoDate);
        if (res.error) throw new Error(res.error);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Reschedule failed — refreshing");
        router.refresh();
      }
    });
  }

  function dayIdxFromIso(iso: string): number {
    // Mon=0, Sun=6
    const d = new Date(iso + "T00:00:00Z");
    return (d.getUTCDay() + 6) % 7;
  }
  // Recipe modal — tap any card to open the work-order detail (recipe +
  // work instructions + traceability). Same WorkOrderModal used by the
  // dept floor queue so the operator gets a consistent in-page experience.
  const [modalOrderId, setModalOrderId] = useState<string | null>(null);

  // ── Filter orders to the selected day. Unscheduled (no production_date)
  //    surface in a banner above the board so they're visible without
  //    bloating the kanban with orphans. ──────────────────────────────────
  const dayOrders = useMemo(
    () => localOrders.filter((o) => o.production_date === selectedDay),
    [localOrders, selectedDay],
  );
  const unscheduledOrders = useMemo(
    () => localOrders.filter((o) => !o.production_date),
    [localOrders],
  );

  // ── Group day's orders by machine_id ──────────────────────────────────────
  // 'unassigned' is the synthetic key for orders without a machine_id. Within
  // each column, sort by run_sequence asc (nulls last → priority asc → code).
  const columns = useMemo(() => {
    const map = new Map<string, Order[]>();
    map.set("unassigned", []);
    for (const m of machines) map.set(m.id, []);
    for (const o of dayOrders) {
      const k = o.machine_id ?? "unassigned";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(o);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const sa = a.run_sequence ?? Number.POSITIVE_INFINITY;
        const sb = b.run_sequence ?? Number.POSITIVE_INFINITY;
        if (sa !== sb) return sa - sb;
        if (a.priority !== b.priority) return a.priority - b.priority;
        return (a.item?.code ?? "").localeCompare(b.item?.code ?? "");
      });
    }
    return map;
  }, [dayOrders, machines]);

  // ── Drop handler — the heavy logic. Two cases: ────────────────────────────
  //
  //   1. Cross-column drop (different machine_id): assign machine + set
  //      run_sequence in the new column.
  //   2. Same-column drop: just reorder run_sequence.
  //
  // Both first apply optimistically (so the card moves instantly) and then
  // call the server action. On error, we router.refresh() to recover.
  // ↑/↓ button reorder — operates only within the same column. Simpler &
  // more reliable than relying on drag-drop alone (Tino, 2026-05-10): the
  // browser dnd model has timing/visibility quirks on tablets and across
  // touchpads. Buttons work everywhere.
  function moveOrder(orderId: string, dir: "up" | "down") {
    const order = localOrders.find(o => o.id === orderId);
    if (!order) return;
    const colKey = order.machine_id ?? "unassigned";
    const colArr = (columns.get(colKey) ?? []).slice();
    const idx = colArr.findIndex(o => o.id === orderId);
    if (idx < 0) return;
    const targetIdx = dir === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= colArr.length) return;
    [colArr[idx], colArr[targetIdx]] = [colArr[targetIdx], colArr[idx]];
    // Optimistic update — re-stamp run_sequence locally
    const stamped = new Map<string, number>();
    colArr.forEach((o, i) => stamped.set(o.id, i + 1));
    setLocalOrders(prev =>
      prev.map(o => (stamped.has(o.id) ? { ...o, run_sequence: stamped.get(o.id)! } : o))
    );
    // Persist
    startTransition(async () => {
      try {
        const res = await reorderMachineQueue(colArr.map(o => o.id));
        if (res.error) throw new Error(res.error);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed — refreshing");
        router.refresh();
      }
    });
  }

  function handleDrop(targetCol: string, targetIndex: number) {
    if (!draggingId) return;
    const dragged = localOrders.find((o) => o.id === draggingId);
    if (!dragged) return;

    const fromCol = dragged.machine_id ?? "unassigned";
    const targetMachineId = targetCol === "unassigned" ? null : targetCol;

    // Build the new column order arrays.
    const newColumns = new Map<string, Order[]>();
    for (const [k, arr] of columns) newColumns.set(k, [...arr]);

    // Remove from source column.
    const fromArr = newColumns.get(fromCol) ?? [];
    const fromIdx = fromArr.findIndex((o) => o.id === draggingId);
    if (fromIdx >= 0) fromArr.splice(fromIdx, 1);

    // Insert into target column at targetIndex.
    const toArr = newColumns.get(targetCol) ?? [];
    // Adjust target index if removing from same column shifted it left.
    let insertAt = targetIndex;
    if (fromCol === targetCol && fromIdx >= 0 && fromIdx < targetIndex) insertAt -= 1;
    toArr.splice(insertAt, 0, { ...dragged, machine_id: targetMachineId });

    // Apply optimistic local update by re-flattening columns into localOrders.
    const newLocal = localOrders.map((o) => {
      if (o.id === draggingId) return { ...o, machine_id: targetMachineId };
      return o;
    });
    // Stamp run_sequence for every order in the touched columns.
    const stamped = new Map<string, number>();
    toArr.forEach((o, i) => stamped.set(o.id, i + 1));
    if (fromCol !== targetCol) fromArr.forEach((o, i) => stamped.set(o.id, i + 1));
    setLocalOrders(
      newLocal.map((o) => (stamped.has(o.id) ? { ...o, run_sequence: stamped.get(o.id)! } : o)),
    );
    setDraggingId(null);
    setDragOver(null);

    // Persist. Cross-column requires assign first, then reorder. Same-column
    // is just a reorder.
    startTransition(async () => {
      try {
        if (fromCol !== targetCol) {
          const res = await assignProductionOrderToMachine(draggingId, targetMachineId);
          if (res.error) throw new Error(res.error);
        }
        // Reorder the target column.
        const targetIds = toArr.map((o) => o.id);
        if (targetIds.length > 0) {
          const res2 = await reorderMachineQueue(targetIds);
          if (res2.error) throw new Error(res2.error);
        }
        // If we left a column behind, its run_sequences also need re-stamping
        // so there are no gaps.
        if (fromCol !== targetCol && fromArr.length > 0) {
          const res3 = await reorderMachineQueue(fromArr.map((o) => o.id));
          if (res3.error) throw new Error(res3.error);
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed — refreshing");
        router.refresh();
      }
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Recent skips — chip showing items that were just removed from this
          dept's view via the Skip button. Click to expand + undo. Only shows
          for the current session — server-side overrides exist independently
          (the rows are also gone from the board because override_qty=0). */}
      {recentSkips.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: "0.5rem",
          marginBottom: "0.75rem",
          padding: "0.5rem 0.75rem",
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: "0.375rem",
          fontSize: "0.75rem",
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
          {showRecentSkips && (
            <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", marginLeft: "0.5rem" }}>
              {recentSkips.map(skip => (
                <span key={skip.override_id} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.15rem 0.5rem", background: "#fff", border: "1px solid #fde68a", borderRadius: "999px" }}>
                  <span style={{ fontFamily: "monospace", color: "#78716c" }}>{skip.itemCode}</span>
                  <span style={{ color: "#1c1917" }}>{skip.itemName}</span>
                  <span style={{ color: "#a8a29e", fontStyle: "italic" }}>· {skip.reason}</span>
                  <button
                    type="button"
                    onClick={() => handleUndoSkip(skip)}
                    title="Undo skip — restores the item to this dept's view (clears the override)"
                    style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer", fontWeight: 700, fontSize: "0.7rem", padding: 0, marginLeft: "0.15rem" }}
                  >↺ Undo</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Day chips — also drop targets (drag a card onto a day to reschedule).
          Plus a "Holding" chip on the right that accepts drops to clear the date. */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        {DAYS_FULL.map((label, i) => {
          const iso = dayOfWeek(weekStart, i);
          const active = iso === selectedDay;
          const count = localOrders.filter((o) => o.production_date === iso).length;
          const isDayHover = dayDropTarget === iso;
          return (
            <button
              key={iso}
              onClick={() => setSelectedDay(iso)}
              onDragOver={e => {
                if (!draggingId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dayDropTarget !== iso) setDayDropTarget(iso);
              }}
              onDragLeave={() => { if (dayDropTarget === iso) setDayDropTarget(null); }}
              onDrop={e => {
                e.preventDefault();
                const id = draggingId;
                setDayDropTarget(null);
                setDraggingId(null);
                setDragOver(null);
                if (id) handleRescheduleToDay(id, iso);
              }}
              className={active ? "btn btn-primary" : "btn btn-secondary"}
              style={{
                fontSize: "0.875rem", padding: "0.5rem 0.875rem",
                outline: isDayHover ? "3px solid #b91c1c" : "none",
                outlineOffset: "1px",
                transition: "outline 0.08s",
              }}
              title="Click to filter the kanban to this day. Drag a card here to reschedule."
            >
              {DAYS_SHORT[i]} <span style={{ opacity: 0.7, marginLeft: "0.25rem" }}>{iso.slice(8, 10)}/{iso.slice(5, 7)}</span>
              {count > 0 && (
                <span style={{ marginLeft: "0.5rem", background: active ? "rgba(255,255,255,0.25)" : "#e5e7eb", padding: "0.1rem 0.45rem", borderRadius: "999px", fontSize: "0.75rem" }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
        {/* Holding chip — drop a card here to clear its date (back to planning). */}
        {(() => {
          const holdCount = localOrders.filter(o => !o.production_date).length;
          const isHover = dayDropTarget === "__holding";
          return (
            <button
              type="button"
              onDragOver={e => {
                if (!draggingId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dayDropTarget !== "__holding") setDayDropTarget("__holding");
              }}
              onDragLeave={() => { if (dayDropTarget === "__holding") setDayDropTarget(null); }}
              onDrop={e => {
                e.preventDefault();
                const id = draggingId;
                setDayDropTarget(null);
                setDraggingId(null);
                setDragOver(null);
                if (id) handleRescheduleToDay(id, null);
              }}
              className="btn btn-secondary"
              style={{
                fontSize: "0.875rem", padding: "0.5rem 0.875rem",
                background: holdCount > 0 ? "#fef3c7" : undefined,
                color: holdCount > 0 ? "#92400e" : undefined,
                outline: isHover ? "3px solid #b91c1c" : "none",
                outlineOffset: "1px",
                marginLeft: "auto",
              }}
              title="Holding bucket — drop a card here to clear its production date so the planner can reassign it later."
            >
              📥 Holding
              {holdCount > 0 && (
                <span style={{ marginLeft: "0.5rem", background: "#fde68a", color: "#92400e", padding: "0.1rem 0.45rem", borderRadius: "999px", fontSize: "0.75rem" }}>
                  {holdCount}
                </span>
              )}
            </button>
          );
        })()}
        {/* Print run sheet for the selected day. Opens a new window so the
            kanban planner doesn't lose their place. */}
        <a
          href={`/dept/${deptSlug}/run-order/print?week=${weekStart}&day=${selectedDay}`}
          target="_blank"
          rel="noopener"
          className="btn btn-secondary"
          style={{ fontSize: "0.875rem", padding: "0.5rem 0.875rem", textDecoration: "none" }}
          title="Open a printable run sheet for the selected day — total plan, RM summary, and per-machine recipes."
        >
          🖨 Print run sheet
        </a>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: "0.75rem 1rem", borderRadius: "0.5rem", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {/* Saving spinner — subtle so it doesn't interrupt operator flow */}
      {isPending && (
        <div style={{ fontSize: "0.75rem", color: "#57534e", marginBottom: "0.5rem" }}>Saving…</div>
      )}

      {/* Unscheduled banner — orders without production_date can't appear in
          a day column, but still need attention. Click to plan dates first. */}
      {unscheduledOrders.length > 0 && (
        <div style={{ background: "#fef3c7", color: "#92400e", padding: "0.75rem 1rem", borderRadius: "0.5rem", marginBottom: "1rem", fontSize: "0.875rem" }}>
          {unscheduledOrders.length} order{unscheduledOrders.length === 1 ? "" : "s"} have no production date — set dates on the plan editor first.
        </div>
      )}

      {/* Status + Finalise bar — single row that combines:
            (a) counts of unfinalised vs. finalised orders for the week,
            (b) Finalise / Unfinalise actions (planner does this AFTER all
                cards are on machines and in the right run order).
          Sits above the kanban so the planner sees the score and acts on it
          without scrolling. Was previously a green "X published" banner; the
          actions used to live on the plan editor. Tino May 2026 wanted a
          linear flow (schedule day → schedule machines → finalise), so the
          buttons live with the screen where the work happens. */}
      {(() => {
        const lockedCount = localOrders.filter(o => o.published_at).length;
        const unfinalisedCount = localOrders.length - lockedCount;
        const canAct = !!planId && deptAliases.length > 0;

        async function doFinalise() {
          if (!canAct) return;
          if (!confirm(`Finalise ${unfinalisedCount} order${unfinalisedCount !== 1 ? "s" : ""}? Operators will see them on the floor screen and run-order changes will lock until you unfinalise.`)) return;
          setError(null);
          startTransition(async () => {
            const r = await publishDeptOrders(planId!, deptAliases);
            if (r.error) { setError(r.error); return; }
            router.refresh();
          });
        }
        async function doUnfinalise() {
          if (!canAct) return;
          if (!confirm(`Unfinalise ${lockedCount} order${lockedCount !== 1 ? "s" : ""}? Cards will become editable again — operators will lose visibility until you finalise next.`)) return;
          setError(null);
          startTransition(async () => {
            const r = await unpublishDeptOrders(planId!, deptAliases);
            if (r.error) { setError(r.error); return; }
            router.refresh();
          });
        }

        return (
          <div style={{
            display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap",
            background: lockedCount > 0 && unfinalisedCount === 0 ? "#dcfce7" : "#fafaf9",
            border: `1px solid ${lockedCount > 0 && unfinalisedCount === 0 ? "#bbf7d0" : "#e7e5e4"}`,
            color: "#1c1917",
            padding: "0.6rem 0.875rem", borderRadius: "0.5rem", marginBottom: "1rem",
            fontSize: "0.8125rem",
          }}>
            <span>
              <strong>{unfinalisedCount}</strong> order{unfinalisedCount !== 1 ? "s" : ""} ready to finalise
              {lockedCount > 0 && (
                <> · <strong>{lockedCount}</strong> already on the floor 🔒</>
              )}
              {(() => {
                const dayCount = localOrders.filter(o => o.production_date === selectedDay && !o.published_at).length;
                if (dayCount === 0) return null;
                return (
                  <span style={{ marginLeft: "0.5rem", color: "#57534e", fontSize: "0.75rem" }}>
                    · <strong>{dayCount}</strong> on {dayLabel(selectedDay)}
                  </span>
                );
              })()}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {/* Per-day finalise — small operators don't plan the whole week
                  before shipping Monday's run. Finalise one day at a time. */}
              {(() => {
                const dayUnfinalised = localOrders.filter(o => o.production_date === selectedDay && !o.published_at && o.status === "planned").length;
                const dayPublished   = localOrders.filter(o => o.production_date === selectedDay && o.published_at).length;
                async function doFinaliseDay() {
                  if (!canAct) return;
                  if (!confirm(`Finalise ${dayUnfinalised} order${dayUnfinalised !== 1 ? "s" : ""} on ${dayLabel(selectedDay)}? Operators see them on the floor screen.`)) return;
                  setError(null);
                  startTransition(async () => {
                    const r = await publishDeptOrdersForDay(planId!, deptAliases, selectedDay);
                    if (r.error) { setError(r.error); return; }
                    router.refresh();
                  });
                }
                async function doUnfinaliseDay() {
                  if (!canAct) return;
                  if (!confirm(`Unfinalise ${dayPublished} order${dayPublished !== 1 ? "s" : ""} on ${dayLabel(selectedDay)}? Cards become editable again.`)) return;
                  setError(null);
                  startTransition(async () => {
                    const r = await unpublishDeptOrdersForDay(planId!, deptAliases, selectedDay);
                    if (r.error) { setError(r.error); return; }
                    router.refresh();
                  });
                }
                return (
                  <>
                    {dayPublished > 0 && (
                      <button
                        type="button"
                        onClick={doUnfinaliseDay}
                        disabled={isPending || !canAct}
                        className="btn-secondary"
                        style={{ fontSize: "0.75rem", padding: "0.4rem 0.75rem" }}
                        title={`Unfinalise just ${dayLabel(selectedDay)}`}
                      >🔓 Unfin. {dayLabel(selectedDay)}</button>
                    )}
                    <button
                      type="button"
                      onClick={doFinaliseDay}
                      disabled={isPending || !canAct || dayUnfinalised === 0}
                      style={{
                        fontSize: "0.8125rem", padding: "0.4rem 0.9rem",
                        background: "#166534", color: "#fff",
                        border: "none", borderRadius: "0.375rem", fontWeight: 600,
                        cursor: dayUnfinalised === 0 ? "not-allowed" : "pointer",
                        opacity: dayUnfinalised === 0 ? 0.5 : 1,
                      }}
                      title={`Finalise only the ${dayLabel(selectedDay)} orders — leave the rest of the week to plan further.`}
                    >
                      ✅ Finalise {dayLabel(selectedDay)}{dayUnfinalised > 0 ? ` (${dayUnfinalised})` : ""}
                    </button>
                  </>
                );
              })()}
              {lockedCount > 0 && (
                <button
                  type="button"
                  onClick={doUnfinalise}
                  disabled={isPending || !canAct}
                  className="btn-secondary"
                  style={{ fontSize: "0.75rem", padding: "0.4rem 0.75rem" }}
                  title="Unfinalise everything for this dept this week"
                >🔓 Unfin. week</button>
              )}
              <button
                type="button"
                onClick={doFinalise}
                disabled={isPending || !canAct || unfinalisedCount === 0}
                style={{
                  fontSize: "0.8125rem", padding: "0.4rem 0.9rem",
                  background: "#1e3a8a", color: "#fff",
                  border: "none", borderRadius: "0.375rem", fontWeight: 600,
                  cursor: unfinalisedCount === 0 ? "not-allowed" : "pointer",
                  opacity: unfinalisedCount === 0 ? 0.5 : 1,
                }}
                title="Lock the entire week's schedule and push to the floor"
              >
                ✅ Finalise week{unfinalisedCount > 0 ? ` (${unfinalisedCount})` : ""}
              </button>
            </div>
            {!canAct && (
              <div style={{ width: "100%", color: "#a16207", fontSize: "0.75rem" }}>
                No demand plan exists for this week yet — create one first to finalise.
              </div>
            )}
          </div>
        );
      })()}

      {/* No machines fallback */}
      {machines.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e7e5e4", padding: "1.5rem", borderRadius: "0.5rem", textAlign: "center", color: "#57534e" }}>
          No active machines registered for this department. Add machines in <a href="/settings/machines" style={{ color: "#1e40af" }}>Settings → Machines</a> first.
        </div>
      ) : (
        /* Kanban grid */
        <div style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(240px, 1fr)", gap: "0.75rem", overflowX: "auto", paddingBottom: "1rem" }}>
          <Column
            key="unassigned"
            colId="unassigned"
            title="Unassigned"
            subtitle="No machine yet"
            tone="warn"
            orders={columns.get("unassigned") ?? []}
            isDragOver={dragOver?.col === "unassigned"}
            dragOverIndex={dragOver?.col === "unassigned" ? dragOver.index : null}
            draggingId={draggingId}
            onDragOver={(idx) => setDragOver({ col: "unassigned", index: idx })}
            onDrop={(idx) => handleDrop("unassigned", idx)}
            onDragStart={setDraggingId}
            onDragEnd={() => { setDraggingId(null); setDragOver(null); }}
            onOpenOrder={setModalOrderId}
          onMoveOrder={moveOrder}
          onEditBatchSize={(o) => { setBatchEditOrder(o); setBatchEditValue(o.target_batch_size != null ? String(o.target_batch_size) : ""); }}
          onUnpublishOne={handleUnpublishOne}
          onSkip={handleSkipOpen}
          />
          {machines.map((m) => (
            <Column
              key={m.id}
              colId={m.id}
              title={m.name}
              subtitle={(() => {
                const colOrders = columns.get(m.id) ?? [];
                const totalKg = colOrders.reduce((s, o) => s + (Number(o.planned_qty) || 0), 0);
                const parts: string[] = [];
                if (m.machine_type) parts.push(m.machine_type);
                if (m.capacity_value) parts.push(`${fmt(m.capacity_value)} ${m.capacity_unit ?? ""}`.trim());
                if (totalKg > 0) parts.push(`📊 ${fmt(totalKg)} kg scheduled`);
                return parts.length > 0 ? parts.join(" · ") : null;
              })()}
              tone={m.status === "operational" ? "ok" : "muted"}
              orders={columns.get(m.id) ?? []}
              isDragOver={dragOver?.col === m.id}
              dragOverIndex={dragOver?.col === m.id ? dragOver.index : null}
              draggingId={draggingId}
              onDragOver={(idx) => setDragOver({ col: m.id, index: idx })}
              onDrop={(idx) => handleDrop(m.id, idx)}
              onDragStart={setDraggingId}
              onDragEnd={() => { setDraggingId(null); setDragOver(null); }}
              onOpenOrder={setModalOrderId}
              onMoveOrder={moveOrder}
              onEditBatchSize={(o) => { setBatchEditOrder(o); setBatchEditValue(o.target_batch_size != null ? String(o.target_batch_size) : ""); }}
              onUnpublishOne={handleUnpublishOne}
              onSkip={handleSkipOpen}
            />
          ))}
        </div>
      )}

      {/* Batch-sizing modal — same structure as the calendar (P2):
          DraggableModal + max batch size input + live "Resulting split" preview.
          See dept-scheduler.tsx for the original implementation. */}
      {batchEditOrder && (() => {
        const planned = Number(batchEditOrder.planned_qty) || 0;
        const target = Number(batchEditValue) || 0;
        const computedN = target > 0 && planned > 0 ? Math.max(1, Math.ceil(planned / target)) : 1;
        const computedSize = computedN > 0 ? planned / computedN : planned;
        return (
          <DraggableModal
            title={`⚙️ Batch sizing — ${batchEditOrder.item?.code ?? ""} ${batchEditOrder.item?.name ?? ""}`}
            subtitle={<>Total to produce: <strong>{fmt(planned)} {batchEditOrder.unit ?? ""}</strong></>}
            accent="#854d0e"
            onClose={() => setBatchEditOrder(null)}
            width={520}
            footer={
              <>
                <button type="button" onClick={() => setBatchEditOrder(null)} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Cancel</button>
                <button type="button" onClick={handleSaveBatchSize} disabled={isPending} className="btn-primary" style={{ fontSize: "0.8125rem" }}>
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
                <label className="form-label">Max batch size ({batchEditOrder.unit ?? "kg"})</label>
                <input
                  type="number" step="0.01" min={0}
                  value={batchEditValue}
                  onChange={e => setBatchEditValue(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleSaveBatchSize(); } }}
                  className="form-input"
                  autoFocus
                  placeholder={batchEditOrder.target_batch_size != null
                    ? `Previously ${batchEditOrder.target_batch_size}`
                    : `e.g. 1000`}
                />
              </div>
              <div>
                <label className="form-label">Total to produce</label>
                <input
                  className="form-input"
                  value={`${fmt(planned)} ${batchEditOrder.unit ?? ""}`}
                  disabled
                  style={{ background: "#fafaf9", color: "#78716c" }}
                />
              </div>
            </div>
            <div style={{ marginTop: "0.75rem", padding: "0.625rem 0.875rem", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "0.375rem", fontSize: "0.8125rem", color: "#854d0e", display: "flex", justifyContent: "space-between" }}>
              <span>Resulting split:</span>
              <strong>{computedN} x {fmt(computedSize)} {batchEditOrder.unit ?? ""}</strong>
            </div>
          </DraggableModal>
        );
      })()}

      {/* In-page recipe & traceability modal — opened by tapping any card.
          Same component used by the dept floor queue so the experience is
          consistent across summary, floor, and machine boards. */}
      {modalOrderId && (
        <WorkOrderModal
          orderId={modalOrderId}
          onClose={() => { setModalOrderId(null); router.refresh(); }}
        />
      )}

      {/* Skip-this-item modal — captures the reason for the mrp_overrides
          audit row, then writes override_qty=0 so the item disappears from
          this dept's view for this plan. Undoable via the chip at the top. */}
      {skipOrder && (
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
              Remove <strong>{skipOrder.item?.code} — {skipOrder.item?.name}</strong> from <strong>{skipOrder.department ?? deptSlug}</strong> for this plan.
              An audit row is written to <code style={{ fontSize: "0.7rem", background: "#f5f5f4", padding: "0.05rem 0.25rem", borderRadius: "0.2rem" }}>mrp_overrides</code> (override_qty = 0).
              Undoable from the chip at the top of this page.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.75rem" }}>
              {Object.entries(SKIP_REASON_LABELS).map(([key, label]) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="skip-reason"
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
                  name="skip-reason"
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

// ─── Column component ────────────────────────────────────────────────────────

function Column({
  colId,
  title,
  subtitle,
  tone,
  orders,
  isDragOver,
  dragOverIndex,
  draggingId,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
  onOpenOrder,
  onMoveOrder,
  onEditBatchSize,
  onUnpublishOne,
  onSkip,
}: {
  colId: string;
  title: string;
  subtitle: string | null;
  tone: "ok" | "warn" | "muted";
  orders: Order[];
  isDragOver: boolean;
  dragOverIndex: number | null;
  draggingId: string | null;
  onDragOver: (index: number) => void;
  onDrop: (index: number) => void;
  onDragStart: (orderId: string) => void;
  onDragEnd: () => void;
  /** Tap-to-open: when an operator taps (rather than drags) a card,
   *  open the recipe + traceability modal at parent level. */
  onOpenOrder: (orderId: string) => void;
  /** ↑/↓ buttons on each card move the order one slot up or down within
   *  its current machine column. Wired in run-order-board.tsx via
   *  reorderMachineQueue + optimistic update. */
  onMoveOrder: (orderId: string, dir: "up" | "down") => void;
  /** Pencil chip on each card opens the DraggableModal batch-sizing
   *  editor — same modal used by dept-scheduler's calendar view. */
  onEditBatchSize: (o: Order) => void;
  /** Per-order unpublish — surfaced on locked cards. */
  onUnpublishOne: (o: Order) => void;
  /** Per-order skip — surfaced on unlocked cards. */
  onSkip: (o: Order) => void;
}) {
  const headerBg = tone === "ok" ? "#dcfce7" : tone === "warn" ? "#fef3c7" : "#e7e5e4";
  const headerFg = tone === "ok" ? "#166534" : tone === "warn" ? "#92400e" : "#44403c";

  return (
    <div
      style={{
        background: "#fafaf9",
        border: isDragOver ? "2px dashed #2563eb" : "1px solid #e7e5e4",
        borderRadius: "0.5rem",
        display: "flex",
        flexDirection: "column",
        minHeight: "300px",
      }}
    >
      <div style={{ background: headerBg, color: headerFg, padding: "0.625rem 0.875rem", borderRadius: "0.5rem 0.5rem 0 0", fontWeight: 600 }}>
        <div style={{ fontSize: "0.875rem" }}>{title}</div>
        {subtitle && <div style={{ fontSize: "0.7rem", opacity: 0.8, marginTop: "0.125rem", fontWeight: 500 }}>{subtitle}</div>}
        <div style={{ fontSize: "0.7rem", opacity: 0.8, marginTop: "0.25rem", fontWeight: 500 }}>{orders.length} order{orders.length === 1 ? "" : "s"}</div>
      </div>

      <div
        style={{ flex: 1, padding: "0.5rem", display: "flex", flexDirection: "column", gap: "0.375rem" }}
        onDragOver={(e) => {
          e.preventDefault();
          if (orders.length === 0) onDragOver(0);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (orders.length === 0) {
            onDrop(0);
          } else {
            onDrop(orders.length);
          }
        }}
      >
        {orders.length === 0 && (
          <div style={{ color: "#a8a29e", fontStyle: "italic", textAlign: "center", padding: "1rem 0", fontSize: "0.8125rem" }}>
            Drop orders here
          </div>
        )}

        {orders.map((o, i) => (
          <div key={o.id}>
            <DropSlot
              active={isDragOver && dragOverIndex === i}
              onDragOver={() => onDragOver(i)}
              onDrop={() => onDrop(i)}
            />
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                onDragOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(i);
              }}
            >
              <Card
                order={o}
                colId={colId}
                isDragging={draggingId === o.id}
                onDragStart={() => onDragStart(o.id)}
                onDragEnd={onDragEnd}
                onOpen={() => onOpenOrder(o.id)}
                onMoveUp={i > 0 ? () => onMoveOrder(o.id, "up") : undefined}
                onMoveDown={i < orders.length - 1 ? () => onMoveOrder(o.id, "down") : undefined}
                onEditBatchSize={() => onEditBatchSize(o)}
                onUnpublishOne={() => onUnpublishOne(o)}
                onSkip={() => onSkip(o)}
              />
            </div>
          </div>
        ))}

        {orders.length > 0 && (
          <DropSlot
            active={isDragOver && dragOverIndex === orders.length}
            onDragOver={() => onDragOver(orders.length)}
            onDrop={() => onDrop(orders.length)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Card component ──────────────────────────────────────────────────────────

function Card({
  order,
  colId,
  isDragging,
  onDragStart,
  onDragEnd,
  onOpen,
  onMoveUp,
  onMoveDown,
  onEditBatchSize,
  onUnpublishOne,
  onSkip,
}: {
  order: Order;
  colId: string;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onEditBatchSize?: () => void;
  /** Per-order unpublish — shown on locked cards. Lets the planner edit a
   *  single order without nuking the whole day's publish state. */
  onUnpublishOne?: () => void;
  /** Skip this item from the dept view by writing an mrp_overrides row
   *  with qty=0. Reason captured via modal in the parent. */
  onSkip?: () => void;
  /** Tap (without dragging) opens the recipe + traceability modal. HTML5
   *  drag and click events are mutually exclusive — a quick tap fires
   *  click, a drag fires dragstart/end so click is suppressed. Operator
   *  on tablet can tap to view, drag to reorder. */
  onOpen: () => void;
}) {
  void colId; // available for future column-aware styling

  // Priority dot — same scale as the floor view (red ≤3, amber ≤6, green else)
  const priColor =
    order.priority <= 3 ? "#dc2626" : order.priority <= 6 ? "#d97706" : "#16a34a";

  // Published orders are committed to the floor — the server actions refuse
  // run-order changes on them, so the card here disables drag too. Tap-to-
  // open still works so the planner can use the "✕ Unpublish" toggle on the
  // work-order page if they need to edit.
  const isLocked = !!order.published_at;

  return (
    <div
      draggable={!isLocked}
      onDragStart={isLocked ? undefined : (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", order.id);
        onDragStart();
      }}
      onDragEnd={isLocked ? undefined : onDragEnd}
      onClick={onOpen}
      title={isLocked
        ? "Locked — published to the floor. Tap to open the work order; use Unpublish there to edit run order."
        : "Tap to open recipe & traceability · drag to reorder"}
      style={{
        background: isLocked ? "#fafaf9" : "#fff",
        border: isLocked ? "1px dashed #a8a29e" : "1px solid #e7e5e4",
        borderRadius: "0.375rem",
        padding: "0.5rem 0.625rem",
        cursor: isLocked ? "pointer" : isDragging ? "grabbing" : "pointer",
        opacity: isDragging ? 0.4 : isLocked ? 0.85 : 1,
        boxShadow: isDragging ? "none" : "0 1px 2px rgba(0,0,0,0.04)",
        backgroundImage: isLocked
          ? "repeating-linear-gradient(45deg, transparent 0 6px, rgba(168,162,158,0.08) 6px 12px)"
          : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: priColor, flexShrink: 0 }} title={`Priority ${order.priority}`} />
            <span style={{ fontWeight: 600, fontSize: "0.8125rem", color: "#1c1917", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {order.item?.code ?? "—"}
            </span>
          </div>
          <div style={{ fontSize: "0.7rem", color: "#57534e", marginTop: "0.125rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {order.item?.name ?? ""}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.2rem", flexShrink: 0 }}>
          {order.run_sequence != null && (
            <span style={{ fontSize: "0.7rem", background: "#1c1917", color: "#fff", padding: "0.1rem 0.4rem", borderRadius: "999px" }}>
              #{order.run_sequence}
            </span>
          )}
          {isLocked && (
            <span
              style={{ fontSize: "0.6rem", background: "#dcfce7", color: "#166534", padding: "0.05rem 0.35rem", borderRadius: "999px", fontWeight: 700 }}
              title="Published to the floor — locked. Tap and use Unpublish on the work-order page to edit run order."
            >
              Locked
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.375rem", fontSize: "0.7rem", color: "#57534e" }}>
        <span>{order.batch_number}</span>
        <span style={{ fontWeight: 600, color: "#1c1917" }}>
          {fmt(order.planned_qty)} {order.unit}
        </span>
      </div>
      {!isLocked && onEditBatchSize && (
        <div
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onEditBatchSize(); }}
          style={{
            marginTop: "0.4rem",
            padding: "0.25rem 0.5rem",
            background: "#dbeafe",
            border: "1px solid #93c5fd",
            color: "#1e3a8a",
            borderRadius: "0.3rem",
            fontFamily: "monospace", fontWeight: 600,
            fontSize: "0.7rem",
            cursor: "pointer",
            display: "inline-block",
          }}
          title="Click to set max batch size — splits the work order into N batches at that capacity."
        >
          {(order.n_of_batches ?? 1) > 1
            ? `⚙ ${order.n_of_batches} × ${fmt(Number(order.batch_size) || 0)} ${order.unit}`
            : `⚙ 1 batch · set sizing`}
        </div>
      )}
      {/* Reorder buttons — tap-friendly, work on touch devices. Stop propagation
          so they don't bubble to the card's onClick (which would open the modal). */}
      {!isLocked && (onMoveUp || onMoveDown) && (
        <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.4rem" }}>
          <button
            type="button"
            disabled={!onMoveUp}
            onMouseDown={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onMoveUp?.(); }}
            title="Move up in run sequence"
            style={{
              flex: 1, padding: "0.3rem 0",
              border: "1px solid #d6d3d1",
              background: onMoveUp ? "white" : "#fafaf9",
              color: onMoveUp ? "#1c1917" : "#cfc9bf",
              borderRadius: "0.25rem",
              cursor: onMoveUp ? "pointer" : "not-allowed",
              fontSize: "0.85rem",
              fontFamily: "inherit",
              lineHeight: 1,
              fontWeight: 700,
            }}
          >↑</button>
          <button
            type="button"
            disabled={!onMoveDown}
            onMouseDown={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onMoveDown?.(); }}
            title="Move down in run sequence"
            style={{
              flex: 1, padding: "0.3rem 0",
              border: "1px solid #d6d3d1",
              background: onMoveDown ? "white" : "#fafaf9",
              color: onMoveDown ? "#1c1917" : "#cfc9bf",
              borderRadius: "0.25rem",
              cursor: onMoveDown ? "pointer" : "not-allowed",
              fontSize: "0.85rem",
              fontFamily: "inherit",
              lineHeight: 1,
              fontWeight: 700,
            }}
          >↓</button>
        </div>
      )}
      {/* Per-order skip — small, low-emphasis. Writes an mrp_overrides row
          with qty=0 so the item disappears from this dept's view for this
          plan, with an audit trail. */}
      {!isLocked && onSkip && (
        <button
          type="button"
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onSkip(); }}
          title="Skip this item from this dept for the current plan (override = 0, audit logged)"
          style={{
            display: "block", width: "100%",
            marginTop: "0.3rem",
            padding: "0.25rem 0",
            background: "transparent",
            border: "1px dashed #d6d3d1",
            color: "#78716c",
            borderRadius: "0.25rem",
            cursor: "pointer",
            fontSize: "0.65rem",
            fontFamily: "inherit",
            letterSpacing: "0.02em",
          }}
        >
          Skip from this dept
        </button>
      )}
      {/* Per-order unpublish on a locked card — lets you edit a single
          order without unfinalising the whole day. */}
      {isLocked && onUnpublishOne && (
        <button
          type="button"
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onUnpublishOne(); }}
          title="Unpublish just this order so it can be edited or moved. Day-level publish stays intact."
          style={{
            display: "block", width: "100%",
            marginTop: "0.3rem",
            padding: "0.3rem 0",
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            color: "#991b1b",
            borderRadius: "0.25rem",
            cursor: "pointer",
            fontSize: "0.7rem",
            fontWeight: 600,
            fontFamily: "inherit",
          }}
        >
          ✕ Unpublish this order
        </button>
      )}
    </div>
  );
}

function dayOfWeekLabel(iso: string | null): string {
  if (!iso) return "—";
  return dayLabel(iso);
}
void dayOfWeekLabel;

// ─── Drop slot — thin band between cards that lights up on drag-over ────────

function DropSlot({
  active,
  onDragOver,
  onDrop,
}: {
  active: boolean;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      style={{
        height: active ? "14px" : "8px",
        background: active ? "#2563eb" : "transparent",
        borderRadius: "3px",
        transition: "height 80ms, background 80ms",
        margin: "1px 0",
      }}
    />
  );
}
