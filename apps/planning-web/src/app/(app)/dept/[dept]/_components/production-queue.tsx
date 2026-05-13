"use client";

/**
 * Production floor queue — what operators see when they walk up to a dept.
 *
 * Layout:
 *   [Sticky filter bar — status chips · date range · product · batch · stats]
 *   [Group: Mon 27/04]
 *     [Card] [Card]
 *   [Group: Tue 28/04]
 *     [Card]
 *   [Group: Unscheduled]
 *     [Card]
 *
 * Behaviour:
 *   • Status chips default to Planned + In Progress (the "open work" view).
 *     Operator can flip Completed on to look back at finished orders, or any
 *     combo. Toggling from "all" clears the others — feels like a quick reset.
 *   • Date range / product / batch filters narrow further.
 *   • Stats summary (planned · in-progress · completed kg & units) lives next
 *     to the chips and updates live as filters change.
 *   • Cards group by production_date (with day-of-week label). Unscheduled
 *     orders pile into a "No date set" group at the top.
 *   • Two-stage commit: ▶ Start opens an inline expander where the operator
 *     enters actuals and explicitly clicks ✓ Complete. No more "click Start
 *     and the order vanishes" — Start can never go straight to completed.
 *   • View Order opens the full work-order page in a popup window (BOM,
 *     traceability, multi-batch input — coming next phase).
 */

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { updateProductionOrder } from "../../actions";
import { useOfflineAction } from "@/lib/offline/use-action";
import WorkOrderModal from "@/components/work-order-modal";

type Order = {
  id: string;
  batch_number: string;
  production_date: string | null;
  day_of_week: number | null;
  batch_size: number;
  n_of_batches: number;
  planned_qty: number;
  actual_qty: number | null;
  unit: string;
  status: string;
  machine: string | null;
  room: string | null;
  priority: number;
  /** Set on the per-machine run-order board. When present, this is the
   *  canonical "today's run order" — the dept queue sorts by it first, with
   *  priority and item code as tie-breakers. */
  run_sequence?: number | null;
  notes: string | null;
  injection_target_pct: number | null;
  actual_pct_injected: number | null;
  tumble_hours: number | null;
  batch_recipe_approved: boolean;
  published_at?: string | null;
  item: { id: string; code: string; name: string; production_method: string | null } | null;
  demand_plan: { week_start: string } | null;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS_LIST: { key: string; label: string; bg: string; fg: string; dot: string }[] = [
  { key: "planned",     label: "Planned",     bg: "#fef3c7", fg: "#92400e", dot: "#f59e0b" },
  { key: "in_progress", label: "In Progress", bg: "#dbeafe", fg: "#1e40af", dot: "#eab308" },
  { key: "on_hold",     label: "On Hold",     bg: "#fef3c7", fg: "#854d0e", dot: "#a16207" },
  { key: "completed",   label: "Completed",   bg: "#dcfce7", fg: "#166534", dot: "#16a34a" },
];

/** Format a number for floor-screen display — keep it dense, no padding. */
function fmt(n: number | null | undefined, dp = 1): string {
  if (n == null || isNaN(Number(n))) return "—";
  const v = Number(n);
  if (Math.abs(v - Math.round(v)) < 0.05) return Math.round(v).toLocaleString("en-AU");
  return v.toLocaleString("en-AU", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Render a date string as "Mon · 27/04". Falls back to "—" when null. */
function dateLabel(iso: string | null): string {
  if (!iso) return "No date set";
  const d = new Date(iso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  return `${DAYS[dow]} · ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export default function ProductionQueue({ orders }: { orders: Order[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<Record<string, string>>({});
  const runUpdate = useOfflineAction("updateProductionOrder", updateProductionOrder);

  // ── Filters ────────────────────────────────────────────────────────────────
  // Default: just the open work. Operator flips Completed on to look back.
  const [statusFilter, setStatusFilter] = useState<Set<string>>(
    new Set(["planned", "in_progress", "on_hold"])
  );
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo,   setDateTo]   = useState<string>("");
  const [productFilter, setProductFilter] = useState<Set<string>>(new Set()); // item_ids
  const [batchFilter,   setBatchFilter]   = useState<Set<string>>(new Set()); // batch_numbers
  const [productSearch, setProductSearch] = useState<string>("");
  const [batchSearch,   setBatchSearch]   = useState<string>("");
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showBatchPicker,   setShowBatchPicker]   = useState(false);
  // Room + Machine filters: multi-select so the operator can pick e.g. all
  // three Filling rooms at once, or two specific machines. Set<string> of
  // the literal room/machine name values that appear on production_orders.
  const [roomFilter,    setRoomFilter]    = useState<Set<string>>(new Set());
  const [machineFilter, setMachineFilter] = useState<Set<string>>(new Set());
  const [showRoomPicker,    setShowRoomPicker]    = useState(false);
  const [showMachinePicker, setShowMachinePicker] = useState(false);
  const [roomSearch,    setRoomSearch]    = useState("");
  const [machineSearch, setMachineSearch] = useState("");
  // Quick-filter card picker open state — starts expanded so operators on
  // first load see big tap buttons for their station. Collapses to a thin
  // bar after they pick something or once they manually close it.
  const [pickerOpen, setPickerOpen] = useState(true);
  // Work-order modal state — set when the operator taps a card. Renders the
  // recipe + work instructions + nested traceability data modal in an
  // iframe-backed full-screen modal (replaces the previous popup-window
  // approach which was awkward on tablets).
  const [modalOrderId, setModalOrderId] = useState<string | null>(null);
  // Day-group sort direction. Defaults to desc (latest day first) per Tino's
  // request — production planning typically wants the imminent days at the
  // top. Operator can flip via the toggle in the filter bar.
  const [dateSortDir, setDateSortDir] = useState<"asc" | "desc">("desc");

  // Distinct products + batches for the multi-select pickers — derived from
  // the raw order list (server already filtered by dept + published).
  const allProducts = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) if (o.item) m.set(o.item.id, `${o.item.code} · ${o.item.name}`);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [orders]);
  const allBatches = useMemo(() => {
    return [...new Set(orders.map(o => o.batch_number))].sort();
  }, [orders]);

  // Distinct rooms + machines for the dropdowns. Derived from the raw order
  // list so the dropdown only shows values that actually appear in this
  // dept's queue (rather than the full register), keeping it tight.
  const allRooms = useMemo(
    () => [...new Set(orders.map(o => (o.room ?? "").trim()).filter(Boolean))].sort(),
    [orders],
  );
  const allMachines = useMemo(
    () => [...new Set(orders.map(o => (o.machine ?? "").trim()).filter(Boolean))].sort(),
    [orders],
  );

  // Apply filters in order: status → date → product → batch → room → machine.
  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (!statusFilter.has(o.status)) return false;
      if (dateFrom && (!o.production_date || o.production_date < dateFrom)) return false;
      if (dateTo   && (!o.production_date || o.production_date > dateTo))   return false;
      if (productFilter.size > 0 && (!o.item || !productFilter.has(o.item.id))) return false;
      if (batchFilter.size > 0   && !batchFilter.has(o.batch_number)) return false;
      if (roomFilter.size    > 0 && !roomFilter.has(o.room    ?? "")) return false;
      if (machineFilter.size > 0 && !machineFilter.has(o.machine ?? "")) return false;
      return true;
    });
  }, [orders, statusFilter, dateFrom, dateTo, productFilter, batchFilter, roomFilter, machineFilter]);

  // ── Stats — computed off the filtered set so the numbers reflect what's
  //    visible. Operator changes filters → stats update live. ───────────────
  const stats = useMemo(() => {
    const acc = {
      planned:     { count: 0, kg: 0, units: 0 },
      in_progress: { count: 0, kg: 0, units: 0 },
      completed:   { count: 0, kg: 0, units: 0 },
    };
    for (const o of filtered) {
      const bucket = o.status === "planned" ? acc.planned
                  : o.status === "in_progress" ? acc.in_progress
                  : o.status === "completed" ? acc.completed
                  : null;
      if (!bucket) continue;
      bucket.count += 1;
      const isKg = (o.unit ?? "").toLowerCase() === "kg";
      if (isKg) bucket.kg += Number(o.planned_qty) || 0;
      else      bucket.units += Number(o.planned_qty) || 0;
    }
    return acc;
  }, [filtered]);

  // ── Group by production_date for the visual layout. Unscheduled orders
  //    (date IS NULL) pile into "No date set" at the top so operator can't
  //    miss them. Within each group, priority asc then code. ───────────────
  const grouped = useMemo(() => {
    const map = new Map<string | null, Order[]>();
    for (const o of filtered) {
      const k = o.production_date ?? null;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(o);
    }
    // Sort: nulls first (unscheduled — operator can't miss them), then
    // by date in the chosen direction (default desc — latest day first,
    // most useful for production planning since today/upcoming sit at top).
    const keys = [...map.keys()].sort((a, b) => {
      if (a === null) return -1;
      if (b === null) return 1;
      const cmp = a.localeCompare(b);
      return dateSortDir === "asc" ? cmp : -cmp;
    });
    return keys.map(k => ({
      date: k,
      orders: (map.get(k) ?? []).sort((x, y) => {
        // run_sequence is the canonical run order set by the per-machine
        // board. Nulls sort last so unsequenced orders pile at the bottom.
        const sx = x.run_sequence ?? Number.POSITIVE_INFINITY;
        const sy = y.run_sequence ?? Number.POSITIVE_INFINITY;
        if (sx !== sy) return sx - sy;
        if (x.priority !== y.priority) return x.priority - y.priority;
        return (x.item?.code ?? "").localeCompare(y.item?.code ?? "");
      }),
    }));
  }, [filtered, dateSortDir]);

  // ── Filter UI helpers ─────────────────────────────────────────────────────
  function toggleStatus(s: string) {
    setStatusFilter(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      // Don't allow clearing all — at least one status must be picked.
      if (next.size === 0) next.add(s);
      return next;
    });
  }
  function toggleProduct(id: string) {
    setProductFilter(prev => {
      const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next;
    });
  }
  function toggleBatch(b: string) {
    setBatchFilter(prev => {
      const next = new Set(prev); if (next.has(b)) next.delete(b); else next.add(b); return next;
    });
  }
  function toggleRoom(r: string) {
    setRoomFilter(prev => {
      const next = new Set(prev); if (next.has(r)) next.delete(r); else next.add(r); return next;
    });
  }
  function toggleMachine(m: string) {
    setMachineFilter(prev => {
      const next = new Set(prev); if (next.has(m)) next.delete(m); else next.add(m); return next;
    });
  }
  function resetFilters() {
    setStatusFilter(new Set(["planned", "in_progress", "on_hold"]));
    setDateFrom(""); setDateTo("");
    setProductFilter(new Set()); setBatchFilter(new Set());
    setRoomFilter(new Set()); setMachineFilter(new Set());
  }
  const filtersActive = dateFrom || dateTo || productFilter.size > 0 || batchFilter.size > 0
    || roomFilter.size > 0 || machineFilter.size > 0
    || statusFilter.has("completed") || statusFilter.size !== 3
    || ![...statusFilter].every(s => ["planned", "in_progress", "on_hold"].includes(s));

  // ── Status update — only ever changes status now. Actual qty / notes /
  // injection % live on the work-order page, not on the floor card. ─────────
  const handleStatusChange = (orderId: string, status: string) => {
    startTransition(async () => {
      const result = await runUpdate(orderId, { status });
      if (result.queued) {
        setMsg(prev => ({ ...prev, [orderId]: "📵 Saved offline — will sync when reconnected" }));
      } else if (result.error) {
        setMsg(prev => ({ ...prev, [orderId]: result.error! }));
      } else {
        setMsg(prev => ({ ...prev, [orderId]: "Saved ✓" }));
        router.refresh();
      }
    });
  };

  // Empty state — nothing in the queue at all (server returned 0).
  if (orders.length === 0) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#78716c" }}>
        <div style={{ fontSize: "2rem" }}>🥩</div>
        <p style={{ marginTop: "0.5rem" }}>No production orders in the queue. Orders appear here once a planner publishes a department in the demand plan.</p>
      </div>
    );
  }

  // Quick-filter picker visibility — derived from picker state, not a hook
  // call here (hooks-after-conditional-return is illegal). pickerOpen state
  // hoisted to the top of the component near the other useState calls.
  const hasStationFilter = roomFilter.size > 0 || machineFilter.size > 0;

  return (
    <div>
      {/* ── Quick-filter picker — operator-friendly big buttons ───────────
          Shown by default so the operator can immediately scope the queue
          to "what should I do at MY station today?". Three rows:
            1. ALL PRODUCTION + summary toggle
            2. By Room — one card per distinct room
            3. By Machine — one card per distinct machine
          Multi-select on rows 2/3 — Tino's spec is "select … or multi
          select optional". Each tap toggles inclusion. */}
      <div style={{
        marginBottom: "1rem", border: "1px solid #e7e5e4", borderRadius: "0.5rem",
        background: "#fff", overflow: "hidden",
      }}>
        <button
          type="button"
          onClick={() => setPickerOpen(o => !o)}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "0.625rem 0.875rem", border: "none", background: hasStationFilter ? "#fef3c7" : "#fafaf9",
            cursor: "pointer", fontWeight: 600, color: "#1c1917", fontSize: "0.875rem",
          }}
          aria-expanded={pickerOpen}
        >
          <span>
            {hasStationFilter
              ? <>🎯 Filtered to {roomFilter.size > 0 && <>{roomFilter.size} room{roomFilter.size > 1 ? "s" : ""}</>}{roomFilter.size > 0 && machineFilter.size > 0 ? " · " : ""}{machineFilter.size > 0 && <>{machineFilter.size} machine{machineFilter.size > 1 ? "s" : ""}</>}</>
              : "🥩 Pick a view — All production · By room · By machine"}
          </span>
          <span style={{ fontSize: "0.75rem", color: "#78716c" }}>{pickerOpen ? "▲ Hide" : "▼ Show"}</span>
        </button>
        {pickerOpen && (
          <div style={{ padding: "0.75rem 0.875rem", borderTop: "1px solid #e7e5e4" }}>
            {/* Row 1 — All production reset */}
            <button
              type="button"
              onClick={() => { setRoomFilter(new Set()); setMachineFilter(new Set()); }}
              style={{
                width: "100%", padding: "0.875rem 1rem",
                border: hasStationFilter ? "1px solid #e7e5e4" : "2px solid #166534",
                borderRadius: "0.5rem",
                background: hasStationFilter ? "#fff" : "#dcfce7",
                color: hasStationFilter ? "#1c1917" : "#166534",
                fontSize: "1rem", fontWeight: 700, cursor: "pointer",
                display: "flex", alignItems: "center", gap: "0.5rem", justifyContent: "center",
                marginBottom: "0.75rem",
              }}
            >
              🥩 ALL PRODUCTION
              <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "#78716c" }}>· {orders.length} orders</span>
            </button>

            {/* Row 2 — Rooms */}
            {allRooms.length > 0 && (
              <>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", margin: "0.25rem 0 0.4rem" }}>
                  🏠 By Room {roomFilter.size > 0 && <span style={{ color: "#1c1917" }}>({roomFilter.size} selected)</span>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.5rem", marginBottom: "0.75rem" }}>
                  {allRooms.map(r => {
                    const active = roomFilter.has(r);
                    const count = orders.filter(o => (o.room ?? "") === r).length;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => toggleRoom(r)}
                        style={{
                          padding: "0.75rem 0.875rem",
                          border: active ? "2px solid #1e3a8a" : "1px solid #e7e5e4",
                          borderRadius: "0.5rem",
                          background: active ? "#dbeafe" : "#fff",
                          color: active ? "#1e3a8a" : "#1c1917",
                          fontSize: "0.875rem", fontWeight: 600, cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>🏠 {r}</div>
                        <div style={{ fontSize: "0.7rem", color: "#78716c", fontWeight: 500, marginTop: "0.15rem" }}>{count} order{count !== 1 ? "s" : ""}</div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Row 3 — Machines */}
            {allMachines.length > 0 && (
              <>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", margin: "0.25rem 0 0.4rem" }}>
                  ⚙ By Machine {machineFilter.size > 0 && <span style={{ color: "#1c1917" }}>({machineFilter.size} selected)</span>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.5rem" }}>
                  {allMachines.map(m => {
                    const active = machineFilter.has(m);
                    const count = orders.filter(o => (o.machine ?? "") === m).length;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => toggleMachine(m)}
                        style={{
                          padding: "0.75rem 0.875rem",
                          border: active ? "2px solid #1e3a8a" : "1px solid #e7e5e4",
                          borderRadius: "0.5rem",
                          background: active ? "#dbeafe" : "#fff",
                          color: active ? "#1e3a8a" : "#1c1917",
                          fontSize: "0.875rem", fontWeight: 600, cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>⚙ {m}</div>
                        <div style={{ fontSize: "0.7rem", color: "#78716c", fontWeight: 500, marginTop: "0.15rem" }}>{count} order{count !== 1 ? "s" : ""}</div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Sticky filter & summary bar ─────────────────────────────────── */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        background: "#fff", borderBottom: "1px solid #e7e5e4",
        marginBottom: "1rem", paddingBottom: "0.75rem",
      }}>
        {/* Stats summary */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
          gap: "0.5rem", marginBottom: "0.75rem",
        }}>
          {[
            { key: "planned",     label: "Planned",     bg: "#fef3c7", fg: "#92400e", data: stats.planned },
            { key: "in_progress", label: "In Progress", bg: "#dbeafe", fg: "#1e40af", data: stats.in_progress },
            { key: "completed",   label: "Completed",   bg: "#dcfce7", fg: "#166534", data: stats.completed },
          ].map(s => (
            <div key={s.key} style={{ background: s.bg, borderRadius: "0.5rem", padding: "0.625rem 0.875rem" }}>
              <div style={{ fontSize: "0.7rem", color: s.fg, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.625rem", marginTop: "0.15rem", flexWrap: "wrap" }}>
                <span style={{ fontSize: "1.4rem", fontWeight: 800, color: s.fg }}>{s.data.count}</span>
                <span style={{ fontSize: "0.75rem", color: s.fg, opacity: 0.85 }}>
                  {s.data.kg > 0 && <>{fmt(s.data.kg)} kg</>}
                  {s.data.kg > 0 && s.data.units > 0 && <> · </>}
                  {s.data.units > 0 && <>{fmt(s.data.units)} units</>}
                  {s.data.kg === 0 && s.data.units === 0 && <span style={{ opacity: 0.6 }}>—</span>}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Filter row — chips + date range + product/batch popovers */}
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</span>
          {STATUS_LIST.map(s => {
            const active = statusFilter.has(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleStatus(s.key)}
                style={{
                  fontSize: "0.7rem", fontWeight: 600,
                  padding: "0.25rem 0.6rem", borderRadius: "9999px",
                  border: active ? `1px solid ${s.fg}` : "1px solid #e7e5e4",
                  background: active ? s.bg : "#fff",
                  color: active ? s.fg : "#78716c",
                  cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: "0.3rem",
                }}
              >
                <span style={{ display: "inline-block", width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: s.dot, opacity: active ? 1 : 0.4 }} />
                {s.label}
              </button>
            );
          })}

          <span style={{ width: 1, height: "1.25rem", background: "#e7e5e4", margin: "0 0.4rem" }} />

          {/* Date range */}
          <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}>Dates</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="form-input" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", width: "auto" }} />
          <span style={{ fontSize: "0.7rem", color: "#78716c" }}>→</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="form-input" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", width: "auto" }} />
          {/* Date sort direction toggle — defaults to desc (latest day first). */}
          <button
            type="button"
            onClick={() => setDateSortDir(d => d === "asc" ? "desc" : "asc")}
            title={dateSortDir === "desc" ? "Latest day first — click to flip" : "Earliest day first — click to flip"}
            style={{
              fontSize: "0.7rem", padding: "0.25rem 0.55rem",
              border: "1px solid #e7e5e4", borderRadius: "0.375rem",
              background: "#fff", color: "#57534e", cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {dateSortDir === "desc" ? "▼ Latest first" : "▲ Earliest first"}
          </button>

          <span style={{ width: 1, height: "1.25rem", background: "#e7e5e4", margin: "0 0.4rem" }} />

          {/* Room picker — multi-select popover. Mirrors Products/Batches. */}
          {allRooms.length > 0 && (
            <div style={{ position: "relative" }}>
              <button type="button"
                onClick={() => { setShowRoomPicker(s => !s); setShowMachinePicker(false); setShowProductPicker(false); setShowBatchPicker(false); }}
                style={{ fontSize: "0.7rem", padding: "0.25rem 0.6rem", border: roomFilter.size > 0 ? "1px solid #1c1917" : "1px solid #e7e5e4", borderRadius: "0.375rem", background: roomFilter.size > 0 ? "#fafaf9" : "#fff", cursor: "pointer", color: "#1c1917", fontWeight: 600 }}
              >
                🏠 Rooms {roomFilter.size > 0 ? `(${roomFilter.size})` : ""} ▾
              </button>
              {showRoomPicker && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20, background: "#fff", border: "1px solid #d6d3d1", borderRadius: "0.5rem", boxShadow: "0 4px 16px rgba(0,0,0,0.1)", padding: "0.5rem", minWidth: "240px", maxHeight: "350px", overflow: "auto" }}>
                  <input value={roomSearch} onChange={e => setRoomSearch(e.target.value)} placeholder="Search rooms…"
                    className="form-input" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginBottom: "0.4rem", width: "100%" }} autoFocus />
                  {roomFilter.size > 0 && (
                    <button type="button" onClick={() => setRoomFilter(new Set())}
                      style={{ fontSize: "0.7rem", color: "#dc2626", background: "none", border: "none", padding: "0.2rem 0", cursor: "pointer" }}>Clear ({roomFilter.size})</button>
                  )}
                  {allRooms
                    .filter(r => !roomSearch || r.toLowerCase().includes(roomSearch.toLowerCase()))
                    .map(r => (
                      <label key={r} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.2rem 0.3rem", cursor: "pointer", fontSize: "0.75rem", borderRadius: "0.25rem" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#fafaf9")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <input type="checkbox" checked={roomFilter.has(r)} onChange={() => toggleRoom(r)} />
                        {r}
                      </label>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Machine picker — multi-select popover. Same shape as Room. */}
          {allMachines.length > 0 && (
            <div style={{ position: "relative" }}>
              <button type="button"
                onClick={() => { setShowMachinePicker(s => !s); setShowRoomPicker(false); setShowProductPicker(false); setShowBatchPicker(false); }}
                style={{ fontSize: "0.7rem", padding: "0.25rem 0.6rem", border: machineFilter.size > 0 ? "1px solid #1c1917" : "1px solid #e7e5e4", borderRadius: "0.375rem", background: machineFilter.size > 0 ? "#fafaf9" : "#fff", cursor: "pointer", color: "#1c1917", fontWeight: 600 }}
              >
                ⚙ Machines {machineFilter.size > 0 ? `(${machineFilter.size})` : ""} ▾
              </button>
              {showMachinePicker && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20, background: "#fff", border: "1px solid #d6d3d1", borderRadius: "0.5rem", boxShadow: "0 4px 16px rgba(0,0,0,0.1)", padding: "0.5rem", minWidth: "240px", maxHeight: "350px", overflow: "auto" }}>
                  <input value={machineSearch} onChange={e => setMachineSearch(e.target.value)} placeholder="Search machines…"
                    className="form-input" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginBottom: "0.4rem", width: "100%" }} autoFocus />
                  {machineFilter.size > 0 && (
                    <button type="button" onClick={() => setMachineFilter(new Set())}
                      style={{ fontSize: "0.7rem", color: "#dc2626", background: "none", border: "none", padding: "0.2rem 0", cursor: "pointer" }}>Clear ({machineFilter.size})</button>
                  )}
                  {allMachines
                    .filter(m => !machineSearch || m.toLowerCase().includes(machineSearch.toLowerCase()))
                    .map(m => (
                      <label key={m} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.2rem 0.3rem", cursor: "pointer", fontSize: "0.75rem", borderRadius: "0.25rem" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#fafaf9")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <input type="checkbox" checked={machineFilter.has(m)} onChange={() => toggleMachine(m)} />
                        {m}
                      </label>
                    ))}
                </div>
              )}
            </div>
          )}

          <span style={{ width: 1, height: "1.25rem", background: "#e7e5e4", margin: "0 0.4rem" }} />

          {/* Product picker (popover) */}
          <div style={{ position: "relative" }}>
            <button type="button"
              onClick={() => { setShowProductPicker(s => !s); setShowBatchPicker(false); }}
              style={{ fontSize: "0.7rem", padding: "0.25rem 0.6rem", border: productFilter.size > 0 ? "1px solid #1c1917" : "1px solid #e7e5e4", borderRadius: "0.375rem", background: productFilter.size > 0 ? "#fafaf9" : "#fff", cursor: "pointer", color: "#1c1917", fontWeight: 600 }}
            >
              Products {productFilter.size > 0 ? `(${productFilter.size})` : ""} ▾
            </button>
            {showProductPicker && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20, background: "#fff", border: "1px solid #d6d3d1", borderRadius: "0.5rem", boxShadow: "0 4px 16px rgba(0,0,0,0.1)", padding: "0.5rem", minWidth: "320px", maxHeight: "350px", overflow: "auto" }}>
                <input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="Search…"
                  className="form-input" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginBottom: "0.4rem", width: "100%" }} autoFocus />
                {productFilter.size > 0 && (
                  <button type="button" onClick={() => setProductFilter(new Set())}
                    style={{ fontSize: "0.7rem", color: "#dc2626", background: "none", border: "none", padding: "0.2rem 0", cursor: "pointer" }}>Clear ({productFilter.size})</button>
                )}
                {allProducts
                  .filter(([, label]) => !productSearch || label.toLowerCase().includes(productSearch.toLowerCase()))
                  .map(([id, label]) => (
                    <label key={id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.2rem 0.3rem", cursor: "pointer", fontSize: "0.75rem", borderRadius: "0.25rem" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#fafaf9")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <input type="checkbox" checked={productFilter.has(id)} onChange={() => toggleProduct(id)} />
                      {label}
                    </label>
                  ))}
              </div>
            )}
          </div>

          {/* Batch picker (popover) */}
          <div style={{ position: "relative" }}>
            <button type="button"
              onClick={() => { setShowBatchPicker(s => !s); setShowProductPicker(false); }}
              style={{ fontSize: "0.7rem", padding: "0.25rem 0.6rem", border: batchFilter.size > 0 ? "1px solid #1c1917" : "1px solid #e7e5e4", borderRadius: "0.375rem", background: batchFilter.size > 0 ? "#fafaf9" : "#fff", cursor: "pointer", color: "#1c1917", fontWeight: 600 }}
            >
              Batches {batchFilter.size > 0 ? `(${batchFilter.size})` : ""} ▾
            </button>
            {showBatchPicker && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20, background: "#fff", border: "1px solid #d6d3d1", borderRadius: "0.5rem", boxShadow: "0 4px 16px rgba(0,0,0,0.1)", padding: "0.5rem", minWidth: "260px", maxHeight: "350px", overflow: "auto" }}>
                <input value={batchSearch} onChange={e => setBatchSearch(e.target.value)} placeholder="Search batches…"
                  className="form-input" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginBottom: "0.4rem", width: "100%" }} autoFocus />
                {batchFilter.size > 0 && (
                  <button type="button" onClick={() => setBatchFilter(new Set())}
                    style={{ fontSize: "0.7rem", color: "#dc2626", background: "none", border: "none", padding: "0.2rem 0", cursor: "pointer" }}>Clear ({batchFilter.size})</button>
                )}
                {allBatches
                  .filter(b => !batchSearch || b.toLowerCase().includes(batchSearch.toLowerCase()))
                  .map(b => (
                    <label key={b} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.2rem 0.3rem", cursor: "pointer", fontSize: "0.75rem", borderRadius: "0.25rem", fontFamily: "monospace" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#fafaf9")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <input type="checkbox" checked={batchFilter.has(b)} onChange={() => toggleBatch(b)} />
                      {b}
                    </label>
                  ))}
              </div>
            )}
          </div>

          {filtersActive && (
            <button type="button" onClick={resetFilters}
              style={{ fontSize: "0.7rem", color: "#dc2626", background: "none", border: "none", padding: "0.2rem 0.4rem", cursor: "pointer", marginLeft: "auto" }}>
              ✕ Reset filters
            </button>
          )}
        </div>
      </div>

      {/* ── Grouped order cards ──────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#78716c", border: "1px dashed #e7e5e4", borderRadius: "0.5rem" }}>
          <p style={{ margin: 0 }}>No orders match the current filters.</p>
          <button type="button" onClick={resetFilters} style={{ marginTop: "0.5rem", fontSize: "0.8125rem", color: "#1e3a8a", background: "none", border: "none", textDecoration: "underline", cursor: "pointer" }}>
            Reset to default
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {grouped.map(group => {
            const groupKg = group.orders.reduce((s, o) => (o.unit ?? "").toLowerCase() === "kg" ? s + Number(o.planned_qty || 0) : s, 0);
            const groupUnits = group.orders.reduce((s, o) => (o.unit ?? "").toLowerCase() !== "kg" ? s + Number(o.planned_qty || 0) : s, 0);
            return (
              <div key={group.date ?? "no-date"}>
                {/* Group header — day · date · count + total qty */}
                <div style={{
                  display: "flex", alignItems: "baseline", gap: "0.75rem",
                  marginBottom: "0.5rem",
                  padding: "0.4rem 0.75rem",
                  background: group.date ? "#1c1917" : "#dc2626",
                  color: "#fff", borderRadius: "0.375rem",
                }}>
                  <span style={{ fontSize: "0.95rem", fontWeight: 700 }}>{dateLabel(group.date)}</span>
                  <span style={{ fontSize: "0.75rem", opacity: 0.85 }}>
                    {group.orders.length} order{group.orders.length !== 1 ? "s" : ""}
                    {groupKg > 0 && ` · ${fmt(groupKg)} kg`}
                    {groupUnits > 0 && ` · ${fmt(groupUnits)} units`}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {group.orders.map(order => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      isPending={isPending}
                      msg={msg[order.id]}
                      onStatusChange={status => handleStatusChange(order.id, status)}
                      onOpen={() => setModalOrderId(order.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* In-page work-order modal — replaces the popup window approach so
          tablet operators can open the recipe + traceability without losing
          their place. Renders the existing /work-orders/[id] page in an
          iframe; the nested traceability data modal still works inside. */}
      {modalOrderId && (
        <WorkOrderModal
          orderId={modalOrderId}
          onClose={() => { setModalOrderId(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

// ─── Order card (one row in a date group) ─────────────────────────────────────

function OrderCard({
  order, isPending, msg, onStatusChange, onOpen,
}: {
  order: Order;
  isPending: boolean;
  msg: string | undefined;
  onStatusChange: (status: string) => void;
  /** Click anywhere on the card to open the recipe + traceability modal.
   *  Replaces the previous popup-window handler so the operator stays on
   *  the floor screen — modal opens in-page, closes return to queue. */
  onOpen: () => void;
}) {
  const isInjection = order.injection_target_pct != null || order.item?.production_method === "injection_tumbling";
  const completion = order.actual_qty && order.planned_qty
    ? Math.round((order.actual_qty / order.planned_qty) * 100)
    : null;
  const statusMeta = STATUS_LIST.find(s => s.key === order.status);

  // Visual mismatch flag: completed orders where actual ≠ planned get a faded
  // amber border so they don't disappear into a sea of identical "✓ Completed"
  // lines. Operator can still see at a glance "this batch ran short / over".
  const hasMismatch = order.status === "completed"
    && order.actual_qty != null
    && Math.abs(Number(order.actual_qty) - Number(order.planned_qty)) > 0.01;

  // Whole-card click → open recipe + traceability modal in-page (parent
  // ProductionQueue passes the open handler). Buttons inside use
  // stopPropagation so Start / Complete / Re-open don't fire it.
  function openOrderPopup() {
    onOpen();
  }

  return (
    <div
      className="card"
      style={{
        padding: 0,
        borderLeft: `4px solid ${statusMeta?.dot ?? "#a8a29e"}`,
        opacity: order.status === "completed" ? (hasMismatch ? 0.92 : 0.7) : 1,
        background: hasMismatch ? "#fffbeb" : undefined,
      }}
    >
      {/* Whole-row click → open work order popup. Buttons inside stop propagation. */}
      <div
        style={{ padding: "0.75rem 1rem", display: "grid", gridTemplateColumns: "auto 1fr auto auto", alignItems: "center", gap: "0.875rem", cursor: "pointer" }}
        onClick={openOrderPopup}
        title="Click anywhere to open the work order page"
      >
        {/* Priority dot */}
        <div style={{
          width: "0.625rem", height: "0.625rem", borderRadius: "50%", flexShrink: 0,
          background: order.priority <= 3 ? "#dc2626" : order.priority <= 6 ? "#d97706" : "#86efac",
        }} title={`Priority ${order.priority}`} />

        {/* Identity + meta */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
            <span style={{ fontFamily: "monospace", fontSize: "0.78rem", color: "#1c1917", fontWeight: 700 }}>
              {order.item?.code ?? "—"}
            </span>
            <span style={{ fontWeight: 600, color: "#1c1917" }}>{order.item?.name ?? "—"}</span>
            {statusMeta && (
              <span style={{
                fontSize: "0.625rem", fontWeight: 700, padding: "0.1rem 0.45rem",
                borderRadius: "9999px", background: statusMeta.bg, color: statusMeta.fg,
              }}>{statusMeta.label}</span>
            )}
            {isInjection && (
              <span style={{ fontSize: "0.625rem", fontWeight: 700, padding: "0.1rem 0.45rem", borderRadius: "9999px", background: "#dbeafe", color: "#1e3a8a" }}>Injection</span>
            )}
            {!order.batch_recipe_approved && (
              <span style={{ fontSize: "0.625rem", fontWeight: 700, padding: "0.1rem 0.45rem", borderRadius: "9999px", background: "#fef3c7", color: "#92400e" }}>Recipe pending</span>
            )}
          </div>
          <div style={{ marginTop: "0.2rem", fontSize: "0.75rem", color: "#78716c", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <span style={{ fontFamily: "monospace" }}>{order.batch_number}</span>
            {order.machine && <span>⚙ {order.machine}</span>}
            {order.room && <span>🏠 {order.room}</span>}
            {order.actual_qty != null && (
              <span style={{ color: "#166534" }}>✓ Actual: {fmt(order.actual_qty)} {order.unit} ({completion}%)</span>
            )}
          </div>
        </div>

        {/* Planned qty */}
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#166534", fontFamily: "monospace" }}>
            {fmt(order.planned_qty)} {order.unit}
          </div>
          {order.n_of_batches > 1 && (
            <div style={{ fontSize: "0.65rem", color: "#a8a29e" }}>
              {order.n_of_batches} × {fmt(order.batch_size)}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          {/* Open work order — always visible. Opens in popup with full BOM
              and per-line lot consumption entry. */}
          <button
            onClick={e => { e.stopPropagation(); openOrderPopup(); }}
            style={{ fontSize: "0.75rem", padding: "0.3125rem 0.6rem", background: "#fff", color: "#1c1917", border: "1px solid #d6d3d1", borderRadius: "0.375rem", cursor: "pointer", fontWeight: 600 }}
            title="Open the full work order with BOM + traceability in a new window"
          >📋 Open</button>
          {order.status === "planned" && (
            <button
              onClick={e => { e.stopPropagation(); onStatusChange("in_progress"); }}
              disabled={isPending}
              style={{ fontSize: "0.75rem", padding: "0.3125rem 0.75rem", background: "#1e3a8a", color: "#fff", border: "none", borderRadius: "0.375rem", cursor: "pointer", fontWeight: 600 }}
              title="Mark as in-progress — does NOT complete the order"
            >▶ Start</button>
          )}
          {order.status === "in_progress" && (
            <button
              onClick={e => {
                e.stopPropagation();
                if (!confirm("Mark this order Complete? Make sure actual qty is entered first.")) return;
                onStatusChange("completed");
              }}
              disabled={isPending}
              style={{ fontSize: "0.75rem", padding: "0.3125rem 0.75rem", background: "#166534", color: "#fff", border: "none", borderRadius: "0.375rem", cursor: "pointer", fontWeight: 600 }}
            >✓ Complete</button>
          )}
          {order.status === "completed" && (
            <button
              onClick={e => {
                e.stopPropagation();
                if (!confirm("Re-open this completed order? It'll go back to In Progress.")) return;
                onStatusChange("in_progress");
              }}
              disabled={isPending}
              style={{ fontSize: "0.75rem", padding: "0.3125rem 0.75rem", background: "#fff", color: "#1e3a8a", border: "1px solid #1e3a8a", borderRadius: "0.375rem", cursor: "pointer", fontWeight: 600 }}
              title="Re-open this completed order if it was finished by mistake"
            >↩ Re-open</button>
          )}
          {msg && (
            <span style={{ fontSize: "0.7rem", color: msg.includes("✓") ? "#166534" : "#dc2626", marginLeft: "0.4rem" }}>{msg}</span>
          )}
        </div>
      </div>
    </div>
  );
}
