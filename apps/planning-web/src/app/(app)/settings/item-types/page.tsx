import { createClient } from "@/lib/supabase/server";
import ItemTypesManager from "./_components/item-types-manager";

export default async function ItemTypesPage() {
  const supabase = await createClient();

  const { data: itemTypes } = await supabase
    .from("item_types")
    .select("id, code, name, description, color, is_purchasable, can_have_bom, is_sellable, is_producible, sort_order, is_active")
    .order("sort_order")
    .order("name");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Item Types</h1>
          <p className="page-subtitle">Configure item types and their behaviour flags — used throughout Item Master, stocktakes and purchasing</p>
        </div>
      </div>
      <ItemTypesManager initialItemTypes={itemTypes ?? []} />
    </div>
  );
}
