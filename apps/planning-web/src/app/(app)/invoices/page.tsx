import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import InvoicesTable from "./_components/invoices-table";

export default async function InvoicesPage() {
  const supabase = await createClient();

  const { data: invoices } = await supabase
    .from("invoices")
    .select(`
      id, invoice_number, invoice_date, due_date, status, currency, subtotal, tax_total, total,
      customer:customer_id(id, code, name),
      order:customer_order_id(id, order_number)
    `)
    .order("invoice_date", { ascending: false })
    .limit(200);

  const list = (invoices ?? []) as {
    id: string; invoice_number: string; invoice_date: string; due_date: string | null;
    status: string; currency: string; subtotal: number | null; tax_total: number | null; total: number | null;
    customer: { id: string; code: string; name: string } | null;
    order: { id: string; order_number: string } | null;
  }[];

  const totalOutstanding = list.filter(i => i.status === "sent").reduce((s, i) => s + (i.total ?? 0), 0);
  const totalPaid = list.filter(i => i.status === "paid").reduce((s, i) => s + (i.total ?? 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-subtitle">All invoices generated from customer orders</p>
        </div>
        <Link href="/orders" className="btn-secondary">← Orders</Link>
      </div>

      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
        {[
          { label: "Total Invoices", value: list.length, color: "#1c1917" },
          { label: "Outstanding", value: `$${totalOutstanding.toFixed(2)}`, color: "#b45309" },
          { label: "Paid", value: `$${totalPaid.toFixed(2)}`, color: "#15803d" },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ borderTop: `3px solid ${s.color}` }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: "0.875rem", color: "#78716c", marginTop: "0.375rem" }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Invoice #</th><th>Customer</th><th>Order #</th>
              <th>Invoice Date</th><th>Due Date</th>
              <th>Subtotal</th><th>GST</th><th>Total</th>
              <th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            <InvoicesTable invoices={list} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
