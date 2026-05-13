import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import InventoryView, { type InventoryRow, type RecentMovement } from "./_components/inventory-view";
import { fetchAllRows } from "@/lib/fetch-all";
import { getTenantId } from "@/lib/tenant";

export default async function InventoryPage() {
  const supabase = await createClient();
  const tenantId = await getTenantId();

  const [
    { data: items },
    { data: costs },
    { data: categories },
    { data: recentTx },
  ] = await Promise.all([
    fetchAllRows((from, to) => supabase
      .from("items")
      .select("id, code, name, item_type, unit, current_stock, min_stock, max_stock, item_category_id, item_subcategory_id")
      .eq("tenant_id", tenantId ?? "")
      .eq("is_active", true)
      .order("code")
      .range(from, to)),
    supabase.from("v_item_cost_health").select("item_id, standard_cost, effective_cost, supplier_min_price, supplier_max_price, supplier_count"),
    supabase.from("item_categories").select("id, name").eq("tenant_id", tenantId ?? "").eq("is_active", true).order("name"),
    supabase
      .from("inventory_transactions")
      .select(`id, tx_type, quantity, unit, notes, created_at, reference_type, reference_id, item:item_id(id, code, name, item_type)`)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  // Map cost lookup
  // effective_cost is the canonical "what cost should every calc use" number from
  // v_item_cost_health (added 2026-05-09). Falls back through:
  //   explicit override (items.standard_cost) → highest supplier price → 0
  const costByItem = new Map<string, { effective_cost: number; supplier_count: number; supplier_min_price: number | null; supplier_max_price: number | null; has_override: boolean }>();
  for (const c of (costs ?? []) as Array<{ item_id: string; standard_cost: number | null; effective_cost: number | null; supplier_count: number; supplier_min_price: number | null; supplier_max_price: number | null }>) {
    costByItem.set(c.item_id, {
      effective_cost:      Number(c.effective_cost ?? 0),
      supplier_count:      Number(c.supplier_count ?? 0),
      supplier_min_price:  c.supplier_min_price != null ? Number(c.supplier_min_price) : null,
      supplier_max_price:  c.supplier_max_price != null ? Number(c.supplier_max_price) : null,
      has_override:        c.standard_cost != null,
    });
  }
  const catByItem = new Map<string, string>();
  // Need a second cheap pass to get category name per item — fetch the items + their category in one shot
  const { data: itemsWithCat } = await supabase
    .from("items")
    .select("id, item_category:item_category_id(name)")
    .eq("tenant_id", tenantId ?? "")
    .eq("is_active", true);
  for (const r of (itemsWithCat ?? []) as unknown as Array<{ id: string; item_category: { name: string } | { name: string }[] | null }>) {
    const cat = Array.isArray(r.item_category) ? r.item_category[0] : r.item_category;
    if (cat?.name) catByItem.set(r.id, cat.name);
  }

  const rows: InventoryRow[] = ((items ?? []) as Array<{
    id: string; code: string; name: string; item_type: string; unit: string;
    current_stock: number; min_stock: number; max_stock: number;
  }>).map(i => {
    const cost = costByItem.get(i.id);
    const effCost = cost?.effective_cost ?? 0;
    const totalValue = effCost * Number(i.current_stock ?? 0);
    return {
      id:            i.id,
      code:          i.code,
      name:          i.name,
      item_type:     i.item_type,
      category:      catByItem.get(i.id) ?? null,
      unit:          i.unit,
      current_stock: Number(i.current_stock ?? 0),
      min_stock:     Number(i.min_stock ?? 0),
      max_stock:     Number(i.max_stock ?? 0),
      standard_cost: effCost,
      supplier_count: cost?.supplier_count ?? 0,
      has_override:   cost?.has_override ?? false,
      total_value:   totalValue,
    };
  });

  const movements: RecentMovement[] = ((recentTx ?? []) as Array<{
    id: string; tx_type: string; quantity: number; unit: string; notes: string | null;
    created_at: string; reference_type: string | null;
    item: { id: string; code: string; name: string; item_type: string } | { id: string; code: string; name: string; item_type: string }[] | null;
  }>).map(t => {
    const it = Array.isArray(t.item) ? t.item[0] : t.item;
    return {
      id: t.id, tx_type: t.tx_type, quantity: Number(t.quantity), unit: t.unit,
      notes: t.notes, created_at: t.created_at, reference_type: t.reference_type,
      item: it ?? null,
    };
  });

  return (
    <InventoryView
      rows={rows}
      categories={(categories ?? []) as { id: string; name: string }[]}
      movements={movements}
    />
  );
}
