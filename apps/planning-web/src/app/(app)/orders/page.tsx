export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import OrdersTable from "./_components/orders-table";

export default async function OrdersPage() {
  const supabase = await createClient();

  const [{ data: raw }, { data: customerList }] = await Promise.all([
    supabase
      .from("customer_orders")
      .select(`
        id, order_number, order_seq, order_date, required_date,
        status, currency, customer_po_number,
        customer:customer_id(id, code, name)
      `)
      .order("order_seq", { ascending: false })
      .limit(500),
    supabase
      .from("customers")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
  ]);

  type OrderRow = {
    id: string; order_number: string; order_seq: number | null;
    order_date: string; required_date: string | null;
    status: string; currency: string; customer_po_number: string | null;
    customer: { id: string; code: string; name: string } | null;
  };

  const orders = (raw ?? []) as unknown as OrderRow[];
  const customers = (customerList ?? []) as { id: string; name: string }[];

  const readyCount = orders.filter(o => o.status === "ready").length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Customer Orders</h1>
          <p className="page-subtitle">
            {readyCount > 0
              ? `${readyCount} order${readyCount !== 1 ? "s" : ""} ready for dispatch`
              : "Track orders from confirmation through dispatch and invoicing"}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.625rem" }}>
          {readyCount > 0 && (
            <Link href="/orders/floor" className="btn-primary" style={{ background: "#15803d" }}>
              📦 Dispatch Floor ({readyCount})
            </Link>
          )}
          {readyCount === 0 && (
            <Link href="/orders/floor" className="btn-secondary">📦 Dispatch Floor</Link>
          )}
          <Link href="/orders/new" className="btn-primary">+ New Order</Link>
        </div>
      </div>

      <OrdersTable orders={orders} customers={customers} />
    </div>
  );
}
