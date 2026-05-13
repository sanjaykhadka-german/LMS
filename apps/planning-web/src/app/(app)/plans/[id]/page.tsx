import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import PlanEditor from "./_components/plan-editor";
import { BackButton } from "@/components/back-button";
import { QuickNav } from "@/components/quick-nav";
import type { PlanStatus } from "@/lib/types";

export default async function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // ── Pass 1: plan + user + profile + everything that doesn't depend on
  //    pickable item-type codes. One Promise.all batch instead of 9
  //    sequential round-trips. Tino reported the page was slow even on
  //    900Mbps internet — each Supabase round-trip is 50-200ms, and the
  //    old serial chain was eating 1.5–2.5 s of pure latency. ──
  const [
    { data: plan },
    { data: { user } },
    { data: rawLines },
    { data: rawMrp },
    { data: rawDeptMaterials },
    { data: rawProductionOrders },
    { data: inheritedAttrs },
    { data: departments },
    { data: itemsLookup },
  ] = await Promise.all([
    supabase
      .from("demand_plans")
      .select("id, week_start, status, notes, created_at")
      .eq("id", id)
      .single(),
    supabase.auth.getUser(),
    // Load existing demand lines with item details
    supabase
      .from("demand_lines")
      .select(`
        id, item_id, demand_type,
        planned_qty_kg, planned_units,
        customer_ref, customer_name,
        required_date, day_of_week,
        priority, notes,
        item:item_id(id, code, name, item_type, unit, weight_mode, target_weight_g, current_stock)
      `)
      .eq("demand_plan_id", id)
      .order("created_at"),
    // Load MRP results with item details
    supabase
      .from("mrp_results")
      .select(`
        id, item_id, department, bom_id,
        required_qty, on_hand_qty, net_required_qty, unit, standard_batch_size,
        suggested_batches, rounded_batches, planned_qty, surplus_qty,
        item:item_id(id, code, name, item_type)
      `)
      .eq("demand_plan_id", id),
    // Per-department materials — RPC walks BOMs once, returns one row per
    // (consuming_dept, component). Reconciles with the global Raw Materials
    // view because both use the same explode_mrp math.
    supabase.rpc("get_plan_dept_materials", { p_demand_plan_id: id }),
    // Production orders for this plan — feeds the per-dept drag-drop scheduler.
    // Includes published_at so the scheduler can show "scheduled vs published"
    // visually (published orders are read-only in the planner).
    supabase
      .from("production_orders")
      .select(`
        id, batch_number, department, production_date, day_of_week,
        planned_qty, batch_size, n_of_batches, target_batch_size,
        unit, status, priority,
        published_at, created_at,
        item:item_id(id, code, name, item_type)
      `)
      .eq("demand_plan_id", id)
      .neq("status", "cancelled")
      .order("priority")
      .order("created_at"),
    // Inherited-attribute view (parent-chain target_weight_g, pack hierarchy).
    // The demand modal merges these with the item's own values so leaf items
    // that lean on a parent for per-piece weight don't render as blank.
    supabase
      .from("v_items_inherited_attrs")
      .select("id, inherited_target_weight_g, inherited_fill_weight_g, inherited_units_per_inner, inherited_units_per_outer, inherited_units_per_pallet"),
    // Active departments — drives the dashboard cards. Source of truth:
    // /settings/departments.
    supabase
      .from("departments")
      .select("id, name, code, sort_order")
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    // Lightweight items lookup for parent-chain walks in the Demand modal
    // (rolls up FG kg by shared parent). RLS scopes to caller's tenant.
    supabase
      .from("items")
      .select("id, code, name, parent_item_id")
      .order("code"),
  ]);

  if (!plan) notFound();

  // Profile + pickable item types — second mini-batch. profile.tenant_id is
  // needed by the item_types filter; we keep the RLS-scoped fetch so the
  // result is correctly tenant-bounded even if the user belongs to multiple.
  const { data: profile } = user
    ? await supabase.from("profiles").select("role, tenant_id").eq("id", user.id).single()
    : { data: null };
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";

  // ── Pass 2: pickable item types + the FG list filtered by them. The FG
  //    fetch can't start until we know which type-codes count as "pickable",
  //    so this stage stays sequential after Pass 1. Cheap — both queries are
  //    small and tenant-scoped. ──
  const { data: pickableTypesRaw } = profile?.tenant_id
    ? await supabase
        .from("item_types")
        .select("id, code, name, color, sort_order, is_sellable, is_producible")
        .eq("tenant_id", profile.tenant_id)
        .eq("is_active", true)
        .or("is_sellable.eq.true,is_producible.eq.true")
        .order("sort_order")
    : { data: null };
  const pickableTypes = (pickableTypesRaw ?? []) as {
    id: string; code: string; name: string; color: string | null;
    sort_order: number | null; is_sellable: boolean; is_producible: boolean;
  }[];
  const pickableTypeCodes = pickableTypes.length > 0
    ? pickableTypes.map(t => t.code)
    : ["finished_good", "fill", "wip", "wipf", "wipp"];

  // FG list for the Add-Item modal. Pack-hierarchy fields feed the multi-unit
  // qty entry (pieces / inners / outers / pallets / kg interchangeably).
  const { data: fgItemsRaw } = await supabase
    .from("items")
    .select("id, code, name, item_type, unit, weight_mode, target_weight_g, current_stock, units_per_inner, units_per_outer, units_per_pallet, fill_weight_g")
    .in("item_type", pickableTypeCodes)
    .eq("is_active", true)
    .order("code");
  type InheritedRow = {
    id: string;
    inherited_target_weight_g: number | null;
    inherited_fill_weight_g: number | null;
    inherited_units_per_inner: number | null;
    inherited_units_per_outer: number | null;
    inherited_units_per_pallet: number | null;
  };
  const inheritedById = new Map<string, InheritedRow>(
    (inheritedAttrs ?? []).map(r => [(r as InheritedRow).id, r as InheritedRow])
  );
  // Merge: own value wins when set, otherwise fall back to the inherited
  // value from the view. Null stays null when neither is set (the modal
  // already handles "no per-piece weight" gracefully — kg input is blank).
  const fgItems = (fgItemsRaw ?? []).map(it => {
    const inh = inheritedById.get(it.id);
    return {
      ...it,
      target_weight_g:  it.target_weight_g  ?? inh?.inherited_target_weight_g  ?? null,
      fill_weight_g:    it.fill_weight_g    ?? inh?.inherited_fill_weight_g    ?? null,
      units_per_inner:  it.units_per_inner  ?? inh?.inherited_units_per_inner  ?? null,
      units_per_outer:  it.units_per_outer  ?? inh?.inherited_units_per_outer  ?? null,
      units_per_pallet: it.units_per_pallet ?? inh?.inherited_units_per_pallet ?? null,
    };
  });

  // departments + itemsLookup were folded into Pass 1's Promise.all above —
  // no second round-trip needed. Both queries are tenant-scoped via RLS.

  // Shape demand lines for the client component
  const initialLines = (rawLines ?? []).map((l, i) => ({
    _key: i,
    id: l.id,
    item_id: l.item_id,
    item: l.item as {
      id: string; code: string; name: string; item_type: string;
      unit: string; weight_mode: string; target_weight_g: number | null; current_stock: number;
    } | undefined,
    demand_type: l.demand_type,
    planned_qty_kg: l.planned_qty_kg != null ? String(l.planned_qty_kg) : "",
    planned_units: l.planned_units != null ? String(l.planned_units) : "",
    customer_ref: l.customer_ref ?? "",
    customer_name: l.customer_name ?? "",
    day_of_week: l.day_of_week != null ? String(l.day_of_week) : "",
    priority: String(l.priority ?? 5),
    notes: l.notes ?? "",
  }));

  const mrpResults = (rawMrp ?? []).map(r => ({
    id: r.id,
    item_id: r.item_id,
    department: r.department,
    bom_id: (r as { bom_id?: string | null }).bom_id ?? null,
    required_qty: r.required_qty,
    on_hand_qty: r.on_hand_qty,
    net_required_qty: r.net_required_qty,
    unit: r.unit,
    standard_batch_size: r.standard_batch_size,
    suggested_batches: r.suggested_batches,
    rounded_batches: r.rounded_batches,
    planned_qty: r.planned_qty,
    surplus_qty: r.surplus_qty,
    item: r.item as { id: string; code: string; name: string; item_type: string } | null,
  }));

  // Shape production orders for the client. Item join may come back as an
  // array depending on Supabase typing — normalize to a single object.
  type RawProductionOrder = {
    id: string;
    batch_number: string;
    department: string | null;
    production_date: string | null;
    day_of_week: number | null;
    planned_qty: number | null;
    batch_size: number | null;
    n_of_batches: number | null;
    target_batch_size: number | null;
    unit: string | null;
    status: string;
    priority: number | null;
    published_at: string | null;
    created_at: string;
    item: { id: string; code: string; name: string; item_type: string } |
          { id: string; code: string; name: string; item_type: string }[] | null;
  };
  const productionOrders = ((rawProductionOrders ?? []) as RawProductionOrder[]).map(o => {
    const item = Array.isArray(o.item) ? o.item[0] : o.item;
    return {
      id: o.id,
      batch_number: o.batch_number,
      department: o.department,
      production_date: o.production_date,
      day_of_week: o.day_of_week,
      planned_qty: o.planned_qty,
      batch_size: o.batch_size,
      n_of_batches: o.n_of_batches,
      target_batch_size: o.target_batch_size,
      unit: o.unit,
      status: o.status,
      priority: o.priority,
      published_at: o.published_at,
      item: item ?? null,
    };
  });

  // Shape per-dept materials rows for the client.
  type RawDeptMaterial = {
    consuming_dept: string;
    component_id: string;
    component_code: string;
    component_name: string;
    component_type: string;
    component_unit: string;
    required_qty: number | string;
    on_hand_qty: number | string;
    net_required_qty: number | string;
    parent_count: number;
    parent_codes: string[];
  };
  const deptMaterialsRows = ((rawDeptMaterials ?? []) as RawDeptMaterial[]).map(r => ({
    consumingDept: r.consuming_dept,
    componentId: r.component_id,
    code: r.component_code,
    name: r.component_name,
    type: r.component_type,
    unit: r.component_unit,
    requiredQty: Number(r.required_qty ?? 0),
    onHand: Number(r.on_hand_qty ?? 0),
    net: Number(r.net_required_qty ?? 0),
    parentCount: r.parent_count,
    parentCodes: r.parent_codes ?? [],
  }));

  const STATUS_LABELS: Record<string, string> = {
    draft: "Draft",
    locked: "Locked",
    in_progress: "In Progress",
    completed: "Completed",
    archived: "Archived",
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <BackButton href="/plans" label="Demand Plans" />
            <span style={{ color: "#d4d4d4" }}>|</span>
            <QuickNav />
          </div>
          <h1 className="page-title" style={{ marginTop: "0.375rem" }}>
            Week of {new Date(plan.week_start).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}
          </h1>
          <div style={{ marginTop: "0.25rem" }}>
            <span className={`badge ${
              plan.status === "completed" ? "badge-green"
              : plan.status === "locked" || plan.status === "in_progress" ? "badge-blue"
              : "badge-gray"
            }`}>
              {STATUS_LABELS[plan.status] ?? plan.status}
            </span>
          </div>
        </div>
      </div>

      <PlanEditor
        planId={id}
        weekStart={plan.week_start}
        status={plan.status as PlanStatus}
        notes={plan.notes}
        initialLines={initialLines as Parameters<typeof PlanEditor>[0]["initialLines"]}
        mrpResults={mrpResults}
        fgItems={(fgItems ?? []) as Parameters<typeof PlanEditor>[0]["fgItems"]}
        // Live item-type catalogue — drives the modal's filter chips + the
        // colour/label of the type badge in the dropdown. No more hard-coded
        // type list anywhere downstream.
        pickableItemTypes={pickableTypes.map(t => ({
          code: t.code,
          name: t.name,
          color: t.color,
        }))}
        departments={(departments ?? []).map(d => ({ id: d.id, name: d.name, code: d.code, sort_order: d.sort_order ?? 0 }))}
        itemsLookup={(itemsLookup ?? []).map(i => ({ id: i.id, code: i.code, name: i.name, parent_item_id: i.parent_item_id ?? null }))}
        deptMaterialsRows={deptMaterialsRows}
        productionOrders={productionOrders}
        isAdmin={isAdmin}
      />
    </div>
  );
}
