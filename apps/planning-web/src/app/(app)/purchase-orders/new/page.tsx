import { createClient } from "@/lib/supabase/server";
import NewPurchaseOrderClient from "./_client";
import { fetchAllRows } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";

export default async function NewPurchaseOrderPage() {
  const supabase = await createClient();

  // Get purchasable item type codes dynamically from item_types table
  const { data: purchasableTypes } = await supabase
    .from("item_types")
    .select("code")
    .eq("is_purchasable", true)
    .eq("is_active", true);
  const purchasableCodes = purchasableTypes?.map(t => t.code) ?? ["raw_material", "packaging"];

  const [{ data: items }, { data: suppliers }, { data: supplierItems }] = await Promise.all([
    // Items that are purchased and have stock levels configured
    fetchAllRows((from, to) => supabase
      .from("items")
      .select("id, code, name, unit, item_type, current_stock, min_stock, max_stock, procurement_type, preferred_supplier_id")
      .in("item_type", purchasableCodes)
      .eq("procurement_type", "purchase")
      .eq("is_active", true)
      .order("code")
      .range(from, to)),

    // All active suppliers
    fetchAllRows((from, to) => supabase
      .from("suppliers")
      .select("id, name, code")
      .eq("is_active", true)
      .order("name")
      .range(from, to)),

    // All supplier_items so we can show price and preferred info
    fetchAllRows((from, to) => supabase
      .from("supplier_items")
      .select("id, item_id, supplier_id, supplier_item_code, unit_price, currency, purchase_uom, purchase_uom_qty, min_order_qty, lead_time_days, is_preferred")
      .range(from, to)),
  ]);

  return (
    <NewPurchaseOrderClient
      allItems={items ?? []}
      allSuppliers={suppliers ?? []}
      supplierItems={supplierItems ?? []}
    />
  );
}
