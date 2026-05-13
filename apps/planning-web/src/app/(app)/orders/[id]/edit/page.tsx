import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import OrderFormClient from "../../_components/order-form-client";
import { fetchAllRows } from "@/lib/fetch-all";

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: order }, { data: customers }, { data: items }] = await Promise.all([
    supabase.from("customer_orders").select(`
      id, order_number, customer_id, customer_po_number,
      required_date, delivery_date, notes, status, currency,
      lines:customer_order_lines(
        id, line_number, item_id, order_uom, qty_ordered, qty_inners, qty_kg_estimated, unit_price, notes,
        item:item_id(id, code, name, item_type, unit, weight_mode, target_weight_g, units_per_inner, inner_per_outer, sell_price_per_inner, sell_price_per_kg)
      )
    `).eq("id", id).single(),
    fetchAllRows((from, to) => supabase.from("customers").select("id, code, name, price_group_id, currency").eq("is_active", true).order("name").range(from, to)),
    fetchAllRows((from, to) => supabase.from("items").select("id, code, name, item_type, unit, weight_mode, target_weight_g, units_per_inner, inner_per_outer, sell_price_per_inner, sell_price_per_kg").eq("is_active", true).order("code").range(from, to)),
  ]);

  if (!order) notFound();

  type RawLine = {
    id: string; line_number: number; item_id: string;
    order_uom: string | null; qty_ordered: number | null;
    qty_inners: number | null; qty_kg_estimated: number | null;
    unit_price: number | null; notes: string | null;
    item: {
      id: string; code: string; name: string; item_type: string; unit: string;
      weight_mode: string | null; target_weight_g: number | null;
      units_per_inner: number | null; inner_per_outer: number | null;
      sell_price_per_inner: number | null; sell_price_per_kg: number | null;
    } | null;
  };

  const lines = ((order.lines ?? []) as unknown as RawLine[])
    .sort((a, b) => a.line_number - b.line_number)
    .map(l => ({
      _key: l.id,
      item_id: l.item_id,
      item: l.item ?? undefined,
      order_uom: (l.order_uom ?? "") as "" | "inner" | "carton" | "kg",
      qty_ordered: l.qty_ordered != null ? String(l.qty_ordered) : "",
      unit_price: l.unit_price != null ? String(l.unit_price) : "",
      notes: l.notes ?? "",
    }));

  return (
    <OrderFormClient
      mode="edit"
      customers={customers ?? []}
      allItems={items ?? []}
      initial={{
        id: order.id,
        order_number: order.order_number,
        customer_id: order.customer_id,
        customer_po_number: order.customer_po_number,
        required_date: order.required_date,
        delivery_date: order.delivery_date,
        notes: order.notes,
        status: order.status,
        currency: order.currency,
        lines,
      }}
    />
  );
}
 