export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import FloorDispatch from "../_components/floor-dispatch";

export default async function FloorOrderDispatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: raw } = await supabase
    .from("customer_orders")
    .select(`
      id, order_number, customer_po_number, required_date, currency, status,
      customer:customer_id(id, name),
      lines:customer_order_lines(
        id, line_number, order_uom, qty_ordered, qty_inners, qty_kg_estimated, unit_price, notes,
        item:item_id(id, code, name, weight_mode, target_weight_g, units_per_inner, inner_per_outer)
      )
    `)
    .eq("id", id)
    .maybeSingle();

  type RawOrder = {
    id: string; order_number: string; customer_po_number: string | null;
    required_date: string | null; currency: string; status: string;
    customer: { id: string; name: string } | { id: string; name: string }[] | null;
    lines: {
      id: string; line_number: number; order_uom: string | null; qty_ordered: number | null;
      qty_inners: number | null; qty_kg_estimated: number | null; unit_price: number | null; notes: string | null;
      item: { id: string; code: string; name: string; weight_mode: string | null; target_weight_g: number | null; units_per_inner: number | null; inner_per_outer: number | null } | null;
    }[];
  };

  const orderRaw = raw as unknown as RawOrder | null;

  if (!orderRaw || orderRaw.status !== "confirmed") {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Dispatch</h1>
            <p className="page-subtitle">Order not available for dispatch</p>
          </div>
          <div style={{ display: "flex", gap: "0.625rem" }}>
            <Link href="/orders/floor" className="btn-secondary">← Dispatch List</Link>
          </div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>⚠️</div>
          <p style={{ fontSize: "1rem", color: "#78716c", margin: 0 }}>
            This order isn&apos;t confirmed or no longer exists.{" "}
            <Link href="/orders/floor" style={{ color: "#b91c1c" }}>Back to dispatch list</Link>.
          </p>
        </div>
      </div>
    );
  }

  const cust = Array.isArray(orderRaw.customer) ? orderRaw.customer[0] : orderRaw.customer;
  const order = {
    id: orderRaw.id,
    order_number: orderRaw.order_number,
    customer_name: cust?.name ?? "Unknown",
    customer_po: orderRaw.customer_po_number,
    required_date: orderRaw.required_date,
    currency: orderRaw.currency,
    lines: (orderRaw.lines ?? []).sort((a, b) => a.line_number - b.line_number),
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dispatch #{order.order_number}</h1>
          <p className="page-subtitle">{order.customer_name}</p>
        </div>
        <div style={{ display: "flex", gap: "0.625rem" }}>
          <Link href="/orders/floor" className="btn-secondary">← Dispatch List</Link>
        </div>
      </div>

      <FloorDispatch orders={[order]} redirectAfterDispatch="/orders/floor" />
    </div>
  );
}
