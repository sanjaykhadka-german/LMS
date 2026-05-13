export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { fetchAllRows } from "@/lib/fetch-all";

export default async function FloorOrderListPage() {
  const supabase = await createClient();

  const { data: raw } = await fetchAllRows((from, to) => supabase
    .from("customer_orders")
    .select(`
      id, order_number, customer_po_number, required_date,
      customer:customer_id(id, name),
      lines:customer_order_lines(id)
    `)
    .eq("status", "confirmed")
    .order("required_date", { ascending: true })
    .order("order_number", { ascending: true })
    .range(from, to));

  type RawOrder = {
    id: string;
    order_number: string;
    customer_po_number: string | null;
    required_date: string | null;
    customer: { id: string; name: string } | { id: string; name: string }[] | null;
    lines: { id: string }[];
  };

  const orders = ((raw ?? []) as unknown as RawOrder[]).map(o => {
    const cust = Array.isArray(o.customer) ? o.customer[0] : o.customer;
    return {
      id: o.id,
      order_number: o.order_number,
      customer_name: cust?.name ?? "Unknown",
      customer_po: o.customer_po_number,
      required_date: o.required_date,
      line_count: (o.lines ?? []).length,
    };
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dispatch Floor</h1>
          <p className="page-subtitle">
            {orders.length === 0
              ? "No confirmed orders waiting for dispatch"
              : `${orders.length} confirmed order${orders.length !== 1 ? "s" : ""} ready to dispatch`}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.625rem" }}>
          <Link href="/orders" className="btn-secondary">← All Orders</Link>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>📦</div>
          <p style={{ fontSize: "1rem", color: "#78716c", margin: 0 }}>
            No confirmed orders waiting for dispatch. Confirm an order from the{" "}
            <Link href="/orders" style={{ color: "#b91c1c" }}>Orders</Link> page.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", maxWidth: "720px", margin: "0 auto" }}>
          {orders.map(o => (
            <Link
              key={o.id}
              href={`/orders/floor/${o.id}`}
              className="card"
              style={{
                display: "block",
                padding: "1rem 1.25rem",
                textDecoration: "none",
                color: "inherit",
                transition: "border-color 120ms ease, box-shadow 120ms ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: "1.25rem", fontWeight: 800, fontFamily: "monospace" }}>
                    #{o.order_number}
                  </div>
                  <div style={{ fontSize: "0.9375rem", fontWeight: 600, marginTop: "0.125rem" }}>
                    {o.customer_name}
                  </div>
                  {o.customer_po && (
                    <div style={{ fontSize: "0.8125rem", color: "#78716c", marginTop: "0.125rem" }}>
                      PO: {o.customer_po}
                    </div>
                  )}
                  <div style={{ fontSize: "0.8125rem", color: "#78716c", marginTop: "0.25rem" }}>
                    {o.line_count} line{o.line_count !== 1 ? "s" : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  {o.required_date && (
                    <>
                      <div style={{ fontSize: "0.75rem", color: "#78716c" }}>Required</div>
                      <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>
                        {new Date(o.required_date).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                      </div>
                    </>
                  )}
                  <div style={{ marginTop: "0.375rem" }}>
                    <span style={{ fontSize: "0.6875rem", background: "#dbeafe", color: "#1e40af", padding: "0.2rem 0.625rem", borderRadius: "999px", fontWeight: 600 }}>
                      CONFIRMED
                    </span>
                  </div>
                  <div style={{ fontSize: "0.875rem", color: "#15803d", fontWeight: 600, marginTop: "0.5rem" }}>
                    Dispatch →
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
