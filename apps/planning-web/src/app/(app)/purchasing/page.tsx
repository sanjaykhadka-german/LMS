import { createClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/tenant";
import PurchasingHub, {
  type NeedNowRow,
  type SupplierOption,
  type SupplierLink,
  type DraftLine,
} from "./_components/purchasing-hub";

export default async function PurchasingPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const sp = searchParams ? await searchParams : undefined;
  const tab = (sp?.tab as
    | "need-now" | "by-item" | "stock" | "open-pos" | "forecast" | "scorecard"
    | undefined) ?? "need-now";

  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) return <div>Tenant not found</div>;

  // Find the most recent demand_plan for this tenant
  const { data: latestPlan } = await supabase
    .from("demand_plans")
    .select("id, week_start, status")
    .eq("tenant_id", tenantId)
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  const [
    { data: items },
    { data: costs },
    { data: prodNeed },
    { data: planNeed },
    { data: supplierLinks },
    { data: suppliers },
    { data: draftLinesRaw },
  ] = await Promise.all([
    supabase
      .from("items")
      .select("id, code, name, item_type, unit, current_stock, min_stock, max_stock, department, standard_cost")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .in("item_type", ["raw_material", "packaging", "consumable"])
      .order("code"),
    supabase.from("v_item_cost_health").select("item_id, effective_cost"),
    supabase.rpc("get_open_production_order_demand"),
    latestPlan ? supabase.rpc("get_plan_dept_materials", { p_demand_plan_id: latestPlan.id }) : Promise.resolve({ data: [] }),
    supabase.from("supplier_items")
      .select("id, item_id, supplier_id, supplier_item_code, supplier_item_name, unit_price, currency, purchase_uom, purchase_uom_qty, min_order_qty, lead_time_days, is_preferred, notes"),
    supabase.from("suppliers")
      .select("id, name, code")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name"),
    // Open draft lines for the current user (RLS scopes)
    supabase
      .from("po_draft_lines")
      .select("id, draft_id, item_id, supplier_id, qty, unit, unit_price, purchase_uom, purchase_uom_qty, notes, created_at, draft:draft_id(status, user_id)")
      .order("created_at"),
  ]);

  // Index lookups
  const costByItem = new Map<string, number>();
  for (const c of (costs ?? []) as Array<{ item_id: string; effective_cost: number | null }>) {
    if (c.effective_cost != null) costByItem.set(c.item_id, Number(c.effective_cost));
  }

  const prodByItem = new Map<string, { needed: number; orders: number }>();
  for (const r of (prodNeed ?? []) as Array<{ item_id: string; total_needed: number; open_order_count: number }>) {
    prodByItem.set(r.item_id, { needed: Number(r.total_needed ?? 0), orders: r.open_order_count ?? 0 });
  }

  const planByItem = new Map<string, number>();
  for (const r of (planNeed ?? []) as Array<{ component_id: string; required_qty: number }>) {
    planByItem.set(r.component_id, (planByItem.get(r.component_id) ?? 0) + Number(r.required_qty ?? 0));
  }

  // Group supplier_items by item_id, picking preferred or cheapest as the "primary"
  type Sup = SupplierLink;
  const supplierByItem = new Map<string, Sup[]>();
  const supLookup = new Map<string, { name: string; code: string | null }>();
  for (const s of (suppliers ?? []) as Array<{ id: string; name: string; code: string | null }>) {
    supLookup.set(s.id, { name: s.name, code: s.code });
  }
  for (const sl of (supplierLinks ?? []) as Array<{
    id: string; item_id: string; supplier_id: string;
    supplier_item_code: string | null; supplier_item_name: string | null;
    unit_price: number; currency: string | null;
    purchase_uom: string | null; purchase_uom_qty: number | null; min_order_qty: number | null;
    lead_time_days: number | null; is_preferred: boolean; notes: string | null;
  }>) {
    const supName = supLookup.get(sl.supplier_id)?.name ?? "—";
    const list = supplierByItem.get(sl.item_id) ?? [];
    list.push({
      supplier_link_id:   sl.id,
      supplier_id:        sl.supplier_id,
      supplier_name:      supName,
      supplier_item_code: sl.supplier_item_code ?? null,
      supplier_item_name: sl.supplier_item_name ?? null,
      unit_price:         Number(sl.unit_price ?? 0),
      currency:           sl.currency ?? "AUD",
      lead_time_days:     sl.lead_time_days,
      purchase_uom:       sl.purchase_uom,
      purchase_uom_qty:   sl.purchase_uom_qty != null ? Number(sl.purchase_uom_qty) : null,
      min_order_qty:      sl.min_order_qty != null ? Number(sl.min_order_qty) : null,
      is_preferred:       !!sl.is_preferred,
      notes:              sl.notes ?? null,
    });
    supplierByItem.set(sl.item_id, list);
  }

  // Build the rows
  const rows: NeedNowRow[] = ((items ?? []) as Array<{
    id: string; code: string; name: string; item_type: string; unit: string;
    current_stock: number; min_stock: number; max_stock: number;
    department: string | null; standard_cost: number | null;
  }>).map(i => {
    const sups = supplierByItem.get(i.id) ?? [];
    // Pick: preferred > cheapest by unit_price-per-base
    const primary = sups.find(s => s.is_preferred)
      ?? sups.slice().sort((a, b) => {
        const aPer = (a.purchase_uom_qty ?? 1) > 0 ? a.unit_price / (a.purchase_uom_qty ?? 1) : a.unit_price;
        const bPer = (b.purchase_uom_qty ?? 1) > 0 ? b.unit_price / (b.purchase_uom_qty ?? 1) : b.unit_price;
        return aPer - bPer;
      })[0];

    const stock = Number(i.current_stock ?? 0);
    const min = Number(i.min_stock ?? 0);
    const max = Number(i.max_stock ?? 0);
    const neededOrders = prodByItem.get(i.id)?.needed ?? 0;
    const neededPlan   = planByItem.get(i.id) ?? 0;

    const gapOrders = Math.max(0, neededOrders - stock);
    const gapPlan   = Math.max(0, neededPlan - stock);
    const gapMin    = Math.max(0, min - stock);
    const gap = Math.max(gapOrders, gapPlan, gapMin);

    let recommended = 0;
    if (gap > 0 && primary) {
      const moq      = primary.min_order_qty ?? 0;
      const packQty  = primary.purchase_uom_qty ?? 1;
      const baseGap  = gap;
      const inPackUnits = packQty > 0 ? Math.ceil(baseGap / packQty) : Math.ceil(baseGap);
      const inConsume   = inPackUnits * packQty;
      recommended = Math.max(inConsume, moq);
    } else if (gap > 0) {
      recommended = gap;
    }

    const effCost = costByItem.get(i.id) ?? 0;
    const costPerConsume = (primary?.unit_price != null && (primary?.purchase_uom_qty ?? 0) > 0)
      ? primary!.unit_price / (primary!.purchase_uom_qty as number)
      : (primary?.unit_price ?? effCost);
    const lineCost = recommended * costPerConsume;

    return {
      id: i.id, code: i.code, name: i.name, item_type: i.item_type, unit: i.unit,
      current_stock: stock, min_stock: min, max_stock: max,
      department: i.department,
      effective_cost: effCost,
      standard_cost: i.standard_cost != null ? Number(i.standard_cost) : null,
      needed_orders: neededOrders,
      needed_plan: neededPlan,
      open_order_count: prodByItem.get(i.id)?.orders ?? 0,
      gap, recommended_qty: recommended,
      supplier_id: primary?.supplier_id ?? null,
      supplier_name: primary?.supplier_name ?? null,
      lead_time_days: primary?.lead_time_days ?? null,
      purchase_uom: primary?.purchase_uom ?? null,
      purchase_uom_qty: primary?.purchase_uom_qty ?? null,
      unit_price: primary?.unit_price ?? null,
      is_preferred: primary?.is_preferred ?? false,
      cost_per_consume: costPerConsume,
      line_cost: lineCost,
      supplier_links: sups,
    };
  });

  // Distinct departments + supplier list for filter pills (cascading)
  const departments = Array.from(new Set(
    rows.map(r => r.department ?? "").filter(Boolean)
  )).sort();

  const supplierOptions: SupplierOption[] = (suppliers ?? []).map((s) => {
    const ss = s as { id: string; name: string; code: string | null };
    return { id: ss.id, name: ss.name, code: ss.code };
  });

  // Currently-open draft lines for THIS user (RLS already scopes; status check belt+braces).
  const draftLines: DraftLine[] = ((draftLinesRaw ?? []) as Array<{
    id: string; draft_id: string; item_id: string; supplier_id: string;
    qty: number; unit: string; unit_price: number | null;
    purchase_uom: string | null; purchase_uom_qty: number | null;
    notes: string | null; created_at: string;
    draft: { status: string; user_id: string } | { status: string; user_id: string }[] | null;
  }>)
    .filter(l => {
      const d = Array.isArray(l.draft) ? l.draft[0] : l.draft;
      return d?.status === "open";
    })
    .map(l => ({
      id:               l.id,
      item_id:          l.item_id,
      supplier_id:      l.supplier_id,
      qty:              Number(l.qty),
      unit:             l.unit,
      unit_price:       l.unit_price != null ? Number(l.unit_price) : null,
      purchase_uom:     l.purchase_uom,
      purchase_uom_qty: l.purchase_uom_qty != null ? Number(l.purchase_uom_qty) : null,
      notes:            l.notes,
    }));

  return (
    <PurchasingHub
      activeTab={tab}
      rows={rows}
      latestPlan={latestPlan ? { id: latestPlan.id, week_start: latestPlan.week_start, status: latestPlan.status } : null}
      departments={departments}
      suppliers={supplierOptions}
      draftLines={draftLines}
    />
  );
}
