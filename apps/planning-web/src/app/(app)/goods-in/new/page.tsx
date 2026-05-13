import { createClient } from "@/lib/supabase/server";
import GoodsInFormClient from "../_components/goods-in-form-client";
import { fetchAllRows } from "@/lib/fetch-all";

export default async function NewGoodsInPage() {
  const supabase = await createClient();

  const [{ data: suppliers }, { data: items }] = await Promise.all([
    fetchAllRows((from, to) => supabase.from("suppliers").select("id, code, name, currency").eq("is_active", true).order("name").range(from, to)),
    fetchAllRows((from, to) => supabase.from("items").select("id, code, name, item_type, unit, purchase_uom, purchase_uom_qty, purchase_uom_type").eq("is_active", true).order("code").range(from, to)),
  ]);

  return (
    <GoodsInFormClient
      mode="create"
      suppliers={suppliers ?? []}
      allItems={items ?? []}
    />
  );
}
