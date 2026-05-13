import { createClient } from "@/lib/supabase/server";
import OrderFormClient from "../_components/order-form-client";
import { fetchAllRows } from "@/lib/fetch-all";

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string }>;
}) {
  const { customer_id } = await searchParams;
  const supabase = await createClient();

  const [{ data: customers }, { data: items }] = await Promise.all([
    fetchAllRows((from, to) => supabase.from("customers").select("id, code, name, price_group_id, currency").eq("is_active", true).order("name").range(from, to)),
    fetchAllRows((from, to) => supabase.from("items").select("id, code, name, item_type, unit, weight_mode, target_weight_g, units_per_inner, inner_per_outer, sell_price_per_inner, sell_price_per_kg").eq("is_active", true).order("code").range(from, to)),
  ]);

  return (
    <OrderFormClient
      mode="create"
      customers={customers ?? []}
      allItems={items ?? []}
      defaultCustomerId={customer_id}
    />
  );
}
