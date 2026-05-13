import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import RunOrderBoard from "../_components/run-order-board";
import WeekPicker from "@/components/week-picker";
import { mondayOf, mondayOfIso } from "@/lib/week-utils";

/**
 * Per-machine run-order board.
 *
 * URL: /dept/{slug}/run-order?week=YYYY-MM-DD&day=YYYY-MM-DD
 *
 * Layout: Kanban-style with one column per machine in the department, plus
 * an "Unassigned" column for orders that haven't been placed on a machine
 * yet. Operator drags cards between columns to set machine_id, drags up/down
 * within a column to set run_sequence (1-indexed). The day-view at
 * /dept/{slug} reads run_sequence asc and surfaces the resulting order.
 *
 * Why this lives on its own page rather than as a tab inside the day-view:
 * the operator-on-the-floor view is intentionally read-only-ish (start /
 * complete / record actuals). Run-order assignment is a planner activity —
 * separating screens keeps the floor uncluttered and gives the planner room
 * for the kanban grid.
 */

const DEPT_CONFIG: Record<string, { label: string; emoji: string; deptAliases: string[] }> = {
  production: { label: "Production", emoji: "🥩", deptAliases: ["production", "wip"] },
  filling:    { label: "Filling",    emoji: "🌭", deptAliases: ["filling", "fill", "wipf"] },
  cooking:    { label: "Cooking",    emoji: "🔥", deptAliases: ["cooking"] },
  packing:    { label: "Packing",    emoji: "📦", deptAliases: ["packing", "finished_good"] },
  labelling:  { label: "Labelling",  emoji: "🏷️", deptAliases: ["labelling"] },
};

const VALID_DEPTS = Object.keys(DEPT_CONFIG);

const FLOOR_STATUSES = ["planned", "in_progress", "on_hold"];

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

export default async function RunOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ dept: string }>;
  searchParams: Promise<{ week?: string; day?: string }>;
}) {
  const { dept } = await params;
  const { week: weekParam, day: dayParam } = await searchParams;

  if (!VALID_DEPTS.includes(dept)) notFound();
  const config = DEPT_CONFIG[dept];

  const supabase = await createClient();
  const weekStart = weekParam ? mondayOfIso(weekParam) : mondayOf(new Date());

  // Default day = Monday of the selected week. Operator can flip via the
  // day chips in the board UI; ?day= keeps the choice deep-linkable.
  const selectedDay = dayParam || weekStart;

  // ── Machines for this department ──────────────────────────────────────────
  // We match departments.name ILIKE one of the dept's aliases. Tracey's
  // departments table is seeded with capitalised names ("Production",
  // "Filling"...) so the alias lower-case form `dept` matches via ILIKE.
  // If a tenant has multiple departments mapping to the same dept slug
  // (rare), the union of their machines surfaces here.
  const aliasNames = config.deptAliases;
  const { data: depts } = await supabase
    .from("departments")
    .select("id, name, code")
    .or(aliasNames.map((a) => `name.ilike.${a},code.ilike.${a}`).join(","));
  const deptIds = (depts ?? []).map((d) => d.id);

  const { data: machines } = deptIds.length > 0
    ? await supabase
        .from("machines")
        .select("id, name, code, machine_type, status, capacity_value, capacity_unit, department_id")
        .in("department_id", deptIds)
        .eq("is_active", true)
        .order("name", { ascending: true })
    : { data: [] };

  // ── Production orders for this dept + week ────────────────────────────────
  // Same query the day-view uses, with two extra columns (machine_id,
  // run_sequence) so the board can render the existing assignment.
  // Floor-screen-style filter: published only, non-cancelled.
  const { data: weekPlans } = await supabase
    .from("demand_plans")
    .select("id")
    .eq("week_start", weekStart);
  const planIds = (weekPlans ?? []).map((p) => p.id);

  const aliases = deptInFilter(config.deptAliases);
  // Pull every planned order for the week, published or not. Run-order is
  // a planning activity (Tino May 2026): planners arrange machines + run
  // sequence BEFORE publishing. Once published, the cards render locked
  // (🔒) so the planner sees what's committed to the floor and can choose
  // to unpublish before editing. Earlier this query had `.not(published_at,
  // is, null)` which made the board only show ALREADY-published orders —
  // exactly the opposite of what planning needs.
  const { data: orders } = planIds.length > 0
    ? await supabase
        .from("production_orders")
        .select(`
          id, batch_number, production_date, day_of_week,
          planned_qty, unit, status, priority, machine_id, run_sequence, batch_size, n_of_batches, target_batch_size,
          machine, department, published_at,
          item:item_id(id, code, name)
        `)
        .in("status", FLOOR_STATUSES)
        .in("department", aliases)
        .in("demand_plan_id", planIds)
        .order("run_sequence", { ascending: true, nullsFirst: false })
        .order("priority", { ascending: true })
    : { data: [] };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{config.emoji} {config.label} — Run Order</h1>
          <p className="page-subtitle">Drag cards between machines to assign · drag up/down to set run order</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <Link href={`/dept/${dept}?week=${weekStart}`} className="btn btn-secondary" style={{ fontSize: "0.875rem" }}>
            ← Back to floor
          </Link>
        </div>
      </div>

      <WeekPicker weekStart={weekStart} />

      <RunOrderBoard
        deptSlug={dept}
        weekStart={weekStart}
        initialDay={selectedDay}
        machines={(machines ?? []) as Parameters<typeof RunOrderBoard>[0]["machines"]}
        orders={(orders ?? []) as Parameters<typeof RunOrderBoard>[0]["orders"]}
        // planId + aliases are required by the new Finalise / Unfinalise
        // controls on the board (which call publishDeptOrders /
        // unpublishDeptOrders, both keyed by plan + dept aliases).
        // Empty array fallbacks let the board hide the controls when the
        // week has no plan yet.
        planId={planIds[0] ?? null}
        deptAliases={aliases}
      />
    </div>
  );
}
