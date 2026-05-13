import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import ProductionQueue from "./_components/production-queue";
import DispatchQueue from "./_components/dispatch-queue";
import WeekPicker from "@/components/week-picker";
import { mondayOf, mondayOfIso } from "@/lib/week-utils";
// FillingQueue / CookingQueue / PackingQueue components are kept in the
// codebase for future use when we layer richer per-stage data (fill weights,
// oven programs, pack yields) on top of the unified production_orders model.
// Today the dept floor screens all use ProductionQueue with a dept filter.

// Each dept-config also lists the production_orders.department values that
// belong to it. Some items still carry legacy item_type values as their dept
// (e.g. "wip" / "wipf" / "finished_good") because items.department wasn't set
// at Generate time — until those are cleaned up we want them to render in the
// most likely matching dept rather than disappearing entirely.
const DEPT_CONFIG: Record<string, { label: string; emoji: string; subtitle: string; deptAliases: string[] }> = {
  production:  { label: "Production",  emoji: "🥩", subtitle: "WIP mixing, mincing, injection & tumbling",
                 deptAliases: ["production", "wip"] },
  filling:     { label: "Filling",     emoji: "🌭", subtitle: "Filling & portioning",
                 deptAliases: ["filling", "fill", "wipf"] },
  cooking:     { label: "Cooking",     emoji: "🔥", subtitle: "Smoking, cooking & pasteurisation",
                 deptAliases: ["cooking"] },
  packing:     { label: "Packing",     emoji: "📦", subtitle: "Retail packing",
                 deptAliases: ["packing", "finished_good"] },
  labelling:   { label: "Labelling",   emoji: "🏷️", subtitle: "Labelling & date coding",
                 deptAliases: ["labelling"] },
  dispatch:    { label: "Dispatch",    emoji: "🚚", subtitle: "Order fulfilment & outbound",
                 deptAliases: ["dispatch"] },
};

const VALID_DEPTS = Object.keys(DEPT_CONFIG);

// Floor screens fetch every non-cancelled status (planned/in_progress/on_hold/
// completed). The client-side filter chips default to Planned + In Progress
// but the operator can flip to Completed at any time to look back at orders
// they've already finished. Cancelled is always excluded — those are dead.
const FLOOR_STATUSES = ["planned", "in_progress", "on_hold", "completed"];

/** Build a Postgres `in.()` filter for case-insensitive matches against the
 *  given alias list. Supabase's .in() is case-sensitive so we expand each
 *  alias to its lower / Title / UPPER variants. Cheap and avoids needing a
 *  citext column. */
function deptInFilter(aliases: string[]): string[] {
  const variants = new Set<string>();
  for (const a of aliases) {
    variants.add(a);
    variants.add(a.toLowerCase());
    variants.add(a.toUpperCase());
    variants.add(a.charAt(0).toUpperCase() + a.slice(1).toLowerCase());
  }
  return [...variants];
}

export default async function DeptPage({
  params,
  searchParams,
}: {
  params: Promise<{ dept: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { dept } = await params;
  const { week: weekParam } = await searchParams;

  if (!VALID_DEPTS.includes(dept)) notFound();

  const config = DEPT_CONFIG[dept];
  const supabase = await createClient();

  // Resolve the selected week (Monday). Default = current week. The picker
  // and the URL stay in sync via ?week=YYYY-MM-DD which we always normalise
  // to the Monday of that week so deep-links never drift.
  const weekStart = weekParam ? mondayOfIso(weekParam) : mondayOf(new Date());

  // ── Production / Filling / Packing / Labelling / Cooking — all share
  //    production_orders as the single source of truth, filtered by dept.
  //
  //    Note: the legacy filling_orders / cooking_orders / packing_orders tables
  //    still exist for richer per-stage data (fill weights, oven programs, pack
  //    yields) but they're not in the order-creation flow today. When we layer
  //    Option β (production_routes), we'll spawn rows in those tables per
  //    route step. For now this unified view shows what's actually planned.
  if (dept === "production" || dept === "filling" || dept === "packing" || dept === "labelling" || dept === "cooking") {
    const aliases = deptInFilter(config.deptAliases);
    // Floor screen rule (Phase 3, May 2026): only PUBLISHED orders are visible
    // to operators. Unpublished orders live in the planner's drag-drop view
    // and shouldn't show up on the floor until the planner explicitly publishes
    // them. Without this filter operators would see half-baked orders the
    // planner is still moving around.
    //
    // Week filter: pre-fetch the demand_plans for the selected week, then
    // filter production_orders by that id list. Two queries is cheaper than
    // dragging Supabase's !inner-join filter through a relationship alias
    // (which threw "page couldn't load" the first time we tried it).
    const { data: weekPlans } = await supabase
      .from("demand_plans")
      .select("id")
      .eq("week_start", weekStart);
    const planIds = (weekPlans ?? []).map(p => p.id);

    const { data: orders } = planIds.length > 0
      ? await supabase
          .from("production_orders")
          .select(`
            id, batch_number, production_date, day_of_week,
            batch_size, n_of_batches, planned_qty, actual_qty, unit,
            status, machine, machine_id, run_sequence, room, priority, notes,
            injection_target_pct, actual_pct_injected, tumble_hours,
            batch_recipe_approved,
            department, published_at,
            item:item_id(id, code, name, production_method),
            demand_plan:demand_plan_id(week_start)
          `)
          .in("status", FLOOR_STATUSES)
          .in("department", aliases)
          .in("demand_plan_id", planIds)
          .not("published_at", "is", null)
          // Sort priority: run_sequence (set on the per-machine board) is the
          // canonical "today's run order" signal. nullsFirst:false parks
          // unsequenced orders at the bottom. Priority + code are tie-breakers
          // so the rendering inside the dept queue stays deterministic.
          .order("run_sequence", { ascending: true, nullsFirst: false })
          .order("priority", { ascending: true })
          .order("production_date", { ascending: true, nullsFirst: false })
      : { data: [] };

    return (
      <DeptLayout config={config}>
        {/* Floor view — operators see what they have to do, in the order
            planning set. Machine allocation + run-order live in the plan
            editor (planning side) so the schedule is locked in before it
            hits the floor. The "⚙ Run Order" link used to be here; removed
            on Tino's request — planning, not floor. */}
        <WeekPicker weekStart={weekStart} />
        <ProductionQueue orders={(orders ?? []) as Parameters<typeof ProductionQueue>[0]["orders"]} />
      </DeptLayout>
    );
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────────
  if (dept === "dispatch") {
    // Find the active (locked/in_progress) demand plan
    const { data: activePlan } = await supabase
      .from("demand_plans")
      .select("id, week_start")
      .in("status", ["locked", "in_progress"])
      .order("week_start", { ascending: false })
      .limit(1)
      .single();

    // Demand lines from the active plan that haven't been dispatched yet
    const { data: pendingLines } = activePlan
      ? await supabase
          .from("demand_lines")
          .select(`
            id, demand_plan_id, item_id, planned_qty_kg, planned_units,
            customer_name, customer_ref, day_of_week, demand_type, notes,
            item:item_id(id, code, name, unit, weight_mode)
          `)
          .eq("demand_plan_id", activePlan.id)
          .in("demand_type", ["customer_order", "export", "transfer"])
          .order("day_of_week", { ascending: true })
      : { data: [] };

    // Recent dispatches (last 7 days)
    const { data: recentDispatches } = await supabase
      .from("dispatch_records")
      .select("id, dispatch_date, qty_units, qty_kg, customer_name, customer_ref, item:item_id(code, name)")
      .gte("dispatch_date", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
      .order("dispatch_date", { ascending: false })
      .limit(30);

    const stats = {
      planned: (pendingLines ?? []).length,
      in_progress: 0,
      completed: (recentDispatches ?? []).length,
    };

    return (
      <DeptLayout config={config} stats={stats} completedLabel="This week">
        <DispatchQueue
          pendingLines={(pendingLines ?? []) as Parameters<typeof DispatchQueue>[0]["pendingLines"]}
          recentDispatches={(recentDispatches ?? []) as Parameters<typeof DispatchQueue>[0]["recentDispatches"]}
        />
      </DeptLayout>
    );
  }

  return notFound();
}

// ─── Shared layout wrapper ────────────────────────────────────────────────────

function DeptLayout({
  config,
  stats,
  completedLabel = "Done",
  children,
}: {
  config: { label: string; emoji: string; subtitle: string };
  /** Optional — when omitted, the layout renders without a stats strip
   *  (the production-floor ProductionQueue computes its own stats from the
   *  filtered orders so it can react to the status/date/product chips). */
  stats?: { planned: number; in_progress: number; completed: number };
  completedLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{config.emoji} {config.label}</h1>
          <p className="page-subtitle">{config.subtitle}</p>
        </div>
      </div>

      {/* Stats strip — only rendered when the page passes pre-computed totals
          (Dispatch). Production-style depts compute their own dynamically. */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
          {[
            ["Planned", stats.planned, "#fef3c7", "#92400e"],
            ["In Progress", stats.in_progress, "#dbeafe", "#1e40af"],
            [completedLabel, stats.completed, "#dcfce7", "#166534"],
          ].map(([label, value, bg, color]) => (
            <div key={label as string} style={{ background: bg as string, borderRadius: "0.5rem", padding: "0.875rem 1rem" }}>
              <div style={{ fontSize: "0.75rem", color: color as string, fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
              <div style={{ fontSize: "1.5rem", fontWeight: "800", color: color as string, marginTop: "0.25rem" }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {children}
    </div>
  );
}
