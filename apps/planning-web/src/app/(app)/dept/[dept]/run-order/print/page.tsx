import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import RunSheetPrint from "./_run-sheet-print";

/**
 * Printable per-day run sheet for a department.
 *
 *   /dept/{slug}/run-order/print?week=YYYY-MM-DD&day=YYYY-MM-DD
 *
 * Layout (browser-print-safe with @media print page breaks):
 *   Page 1      — Total Plan for the day (every WO across every machine,
 *                 in run-sequence order, with code/name/batches/qty)
 *   Page 2      — Raw Material Summary for the dept on that day (totals
 *                 across every BOM)
 *   Page 3+     — One section per machine: machine header + per-WO recipes
 *                 with Single Batch and Total columns.
 *
 * Server component fetches everything in parallel, hands it to the client
 * RunSheetPrint which renders + auto-opens the browser print dialog if the
 * URL has ?auto=1.
 */

const DEPT_CONFIG: Record<string, { label: string; emoji: string; deptAliases: string[] }> = {
  production: { label: "Production", emoji: "🥩", deptAliases: ["production", "wip"] },
  filling:    { label: "Filling",    emoji: "🌭", deptAliases: ["filling", "fill", "wipf"] },
  cooking:    { label: "Cooking",    emoji: "🔥", deptAliases: ["cooking"] },
  packing:    { label: "Packing",    emoji: "📦", deptAliases: ["packing", "finished_good"] },
  labelling:  { label: "Labelling",  emoji: "🏷️", deptAliases: ["labelling"] },
};

const VALID_DEPTS = Object.keys(DEPT_CONFIG);

export default async function RunSheetPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ dept: string }>;
  searchParams: Promise<{ week?: string; day?: string; auto?: string }>;
}) {
  const { dept } = await params;
  const { week, day, auto } = await searchParams;

  if (!VALID_DEPTS.includes(dept)) notFound();
  const config = DEPT_CONFIG[dept];
  if (!day) notFound();

  const supabase = await createClient();

  // Build dept alias variants for the .in() filter (case-insensitive matching).
  const variants = new Set<string>();
  for (const a of config.deptAliases) {
    variants.add(a);
    variants.add(a.toLowerCase());
    variants.add(a.toUpperCase());
    variants.add(a.charAt(0).toUpperCase() + a.slice(1).toLowerCase());
  }
  const aliasList = [...variants];

  // Find the demand_plan for that week so we can ask the materials RPC.
  const weekStart = week ?? day;
  const { data: plans } = await supabase
    .from("demand_plans")
    .select("id, week_start")
    .eq("week_start", weekStart);
  const planId = plans?.[0]?.id ?? null;

  // ── Production orders for this dept + day ──────────────────────────────────
  const { data: ordersRaw } = await supabase
    .from("production_orders")
    .select(`
      id, batch_number, production_date, day_of_week,
      planned_qty, unit, status, priority, machine_id, run_sequence,
      batch_size, n_of_batches, target_batch_size,
      machine, department, published_at,
      item:item_id(id, code, name, item_type)
    `)
    .in("department", aliasList)
    .eq("production_date", day)
    .neq("status", "cancelled")
    .order("run_sequence", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: true });

  type OrderRow = {
    id: string; batch_number: string; production_date: string | null;
    planned_qty: number | null; unit: string | null; status: string;
    machine_id: string | null; run_sequence: number | null;
    batch_size: number | null; n_of_batches: number | null;
    target_batch_size: number | null; machine: string | null;
    item: { id: string; code: string; name: string; item_type: string } | { id: string; code: string; name: string; item_type: string }[] | null;
  };
  const orders = ((ordersRaw ?? []) as OrderRow[]).map(o => ({
    ...o,
    item: Array.isArray(o.item) ? (o.item[0] ?? null) : o.item,
  }));

  // ── Machines for the dept ──────────────────────────────────────────────────
  const { data: depts } = await supabase
    .from("departments")
    .select("id, name, code")
    .or(config.deptAliases.map((a) => `name.ilike.${a},code.ilike.${a}`).join(","));
  const deptIds = (depts ?? []).map((d) => d.id);

  const { data: machinesRaw } = deptIds.length > 0
    ? await supabase
        .from("machines")
        .select("id, name, code, machine_type, capacity_value, capacity_unit")
        .in("department_id", deptIds)
        .eq("is_active", true)
        .order("name", { ascending: true })
    : { data: [] };
  const machines = (machinesRaw ?? []) as Array<{
    id: string; name: string; code: string | null;
    machine_type: string | null; capacity_value: number | null; capacity_unit: string | null;
  }>;

  // ── BOMs for every distinct item on the day, so we can render recipes ─────
  const itemIds = [...new Set(orders.map(o => o.item?.id).filter((x): x is string => !!x))];
  type BomRecipe = {
    bom_id: string;
    reference_batch_size: number;
    yield_factor: number;
    lines: Array<{
      bom_line_id: string;
      component_id: string;
      code: string;
      name: string;
      item_type: string;
      qty_per_batch: number;
      unit: string;
      percentage: number | null;
      grind_size: string | null;
      category_id: string | null;
      category_name: string | null;
      category_color: string | null;
    }>;
  };
  const bomByItem = new Map<string, BomRecipe>();

  if (itemIds.length > 0) {
    const { data: bomHeaders } = await supabase
      .from("bom_headers")
      .select("id, item_id, reference_batch_size, yield_factor, is_active")
      .in("item_id", itemIds)
      .eq("is_active", true);

    const headerByItem = new Map<string, { id: string; reference_batch_size: number; yield_factor: number }>();
    for (const h of (bomHeaders ?? []) as Array<{ id: string; item_id: string; reference_batch_size: number; yield_factor: number }>) {
      headerByItem.set(h.item_id, { id: h.id, reference_batch_size: Number(h.reference_batch_size), yield_factor: Number(h.yield_factor) });
    }

    const headerIds = [...headerByItem.values()].map(h => h.id);
    if (headerIds.length > 0) {
      const { data: bomLines } = await supabase
        .from("bom_lines")
        .select(`
          id, bom_header_id, qty_per_batch, unit, percentage, grind_size, sort_order,
          component:component_item_id(id, code, name, item_type, item_category:item_category_id(id, name, color))
        `)
        .in("bom_header_id", headerIds)
        .order("sort_order");

      type LineRow = {
        id: string;
        bom_header_id: string;
        qty_per_batch: number;
        unit: string | null;
        percentage: number | null;
        grind_size: string | null;
        component: {
          id: string; code: string; name: string; item_type: string;
          item_category: { id: string; name: string; color: string | null } | { id: string; name: string; color: string | null }[] | null;
        } | {
          id: string; code: string; name: string; item_type: string;
          item_category: { id: string; name: string; color: string | null } | { id: string; name: string; color: string | null }[] | null;
        }[] | null;
      };
      const linesByHeader = new Map<string, BomRecipe["lines"]>();
      for (const l of (bomLines ?? []) as LineRow[]) {
        const c = Array.isArray(l.component) ? l.component[0] : l.component;
        if (!c) continue;
        const cat = Array.isArray(c.item_category) ? c.item_category[0] : c.item_category;
        const arr = linesByHeader.get(l.bom_header_id) ?? [];
        arr.push({
          bom_line_id: l.id,
          component_id: c.id,
          code: c.code,
          name: c.name,
          item_type: c.item_type,
          qty_per_batch: Number(l.qty_per_batch) || 0,
          unit: l.unit ?? "kg",
          percentage: l.percentage != null ? Number(l.percentage) : null,
          grind_size: l.grind_size ?? null,
          category_id: cat?.id ?? null,
          category_name: cat?.name ?? null,
          category_color: cat?.color ?? null,
        });
        linesByHeader.set(l.bom_header_id, arr);
      }

      for (const [itemId, header] of headerByItem) {
        bomByItem.set(itemId, {
          bom_id: header.id,
          reference_batch_size: header.reference_batch_size,
          yield_factor: header.yield_factor,
          lines: linesByHeader.get(header.id) ?? [],
        });
      }
    }
  }

  // ── Per-day RM summary across the whole dept ──────────────────────────────
  type RmRow = {
    consuming_dept: string;
    production_date: string | null;
    component_id: string;
    component_code: string;
    component_name: string;
    component_type: string;
    component_unit: string;
    required_qty: number;
    on_hand_qty: number;
    parent_codes: string[];
  };
  let rmRows: RmRow[] = [];
  if (planId) {
    const { data: rms } = await supabase.rpc("get_plan_dept_materials_by_day", { p_demand_plan_id: planId });
    rmRows = ((rms ?? []) as RmRow[]).filter(r =>
      r.production_date === day &&
      aliasList.map(a => a.toLowerCase()).includes((r.consuming_dept ?? "").toLowerCase())
    );
  }

  return (
    <RunSheetPrint
      deptLabel={config.label}
      deptEmoji={config.emoji}
      day={day}
      machines={machines}
      orders={orders}
      bomByItem={Object.fromEntries(bomByItem)}
      rmRows={rmRows}
      autoPrint={auto === "1"}
    />
  );
}
