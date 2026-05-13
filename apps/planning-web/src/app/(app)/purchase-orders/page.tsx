import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  draft: "badge-yellow",
  sent: "badge-blue",
  received: "badge-green",
  cancelled: "badge-red",
};

export default async function PurchaseOrdersPage() {
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("purchase_orders")
    .select("id, po_number, status, order_date, expected_date, notes, supplier:supplier_id(id, name, code)")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Purchase Orders</h1>
          <p className="page-subtitle">Order raw materials from suppliers based on stock levels</p>
        </div>
        <Link href="/purchase-orders/new" className="btn-primary">+ New Order</Link>
      </div>

      {(!orders || orders.length === 0) ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem", color: "#78716c" }}>
          <p style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>No purchase orders yet</p>
          <p style={{ fontSize: "0.875rem" }}>Create your first purchase order to restock raw materials.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>PO Number</th>
                <th>Supplier</th>
                <th>Status</th>
                <th>Order Date</th>
                <th>Expected</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map(po => {
                const supplier = po.supplier as { id: string; name: string; code: string | null } | null;
                return (
                  <tr key={po.id}>
                    <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{po.po_number ?? "—"}</td>
                    <td>
                      {supplier ? (
                        <div>
                          <div style={{ fontWeight: 500 }}>{supplier.name}</div>
                          {supplier.code && <div style={{ fontSize: "0.75rem", color: "#78716c", fontFamily: "monospace" }}>{supplier.code}</div>}
                        </div>
                      ) : <span style={{ color: "#a8a29e" }}>No supplier</span>}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_COLORS[po.status] ?? "badge-yellow"}`}>
                        {po.status.charAt(0).toUpperCase() + po.status.slice(1)}
                      </span>
                    </td>
                    <td style={{ color: "#78716c", fontSize: "0.875rem" }}>
                      {po.order_date ? new Date(po.order_date).toLocaleDateString("en-AU") : "—"}
                    </td>
                    <td style={{ color: "#78716c", fontSize: "0.875rem" }}>
                      {po.expected_date ? new Date(po.expected_date).toLocaleDateString("en-AU") : "—"}
                    </td>
                    <td style={{ color: "#78716c", fontSize: "0.875rem", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {po.notes ?? "—"}
                    </td>
                    <td>
                      <Link
                        href={`/purchase-orders/${po.id}`}
                        className="btn-secondary"
                        style={{ fontSize: "0.75rem", padding: "0.25rem 0.75rem" }}
                      >
                        {po.status === "draft" ? "Continue" : "View"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
