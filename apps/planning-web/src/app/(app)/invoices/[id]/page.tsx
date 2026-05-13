import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BackButton } from "@/components/back-button";
import { QuickNav } from "@/components/quick-nav";
import InvoiceActions from "./_components/invoice-actions";
import type { InvoiceTemplateId } from "@/lib/invoice-templates";

const STATUS_COLORS: Record<string, string> = {
  draft: "badge-gray", sent: "badge-blue", paid: "badge-green", void: "badge-red",
};

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: invoice, error: invoiceErr } = await supabase
    .from("invoices")
    .select(`
      *,
      customer:customer_id(id, code, name, email, phone, billing_address_line1, billing_address_line2, billing_city, billing_state, billing_postcode, abn),
      order:customer_order_id(id, order_number, customer_po_number,
        lines:customer_order_lines(id, line_number, qty_units, qty_kg, unit_price, line_total, notes,
          item:item_id(id, code, name, unit, item_type)))
    `)
    .eq("id", id)
    .single();

  if (invoiceErr) console.error("[invoices/[id]] query error:", invoiceErr);
  if (!invoice) notFound();

  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("invoice_template_id")
    .eq("id", invoice.tenant_id)
    .maybeSingle();

  const tenantDefaultTemplate = ((tenantRow?.invoice_template_id ?? "classic") as InvoiceTemplateId);
  const invoiceTemplateId = (invoice.template_id ?? null) as InvoiceTemplateId | null;

  const customer = invoice.customer as Record<string, string | null> | null;
  const order = invoice.order as {
    id: string; order_number: string; customer_po_number: string | null;
    lines: { id: string; line_number: number; qty_units: number | null; qty_kg: number | null; unit_price: number | null; line_total: number | null; notes: string | null;
      item: { id: string; code: string; name: string; unit: string; item_type: string } | null }[];
  } | null;

  const lines = (order?.lines ?? []).sort((a, b) => a.line_number - b.line_number);

  return (
    <div style={{ maxWidth: "860px" }}>
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <BackButton href="/invoices" label="Invoices" />
            <span style={{ color: "#d4d4d4" }}>|</span>
            <QuickNav />
          </div>
          <h1 className="page-title" style={{ marginTop: "0.375rem" }}>{invoice.invoice_number}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginTop: "0.375rem" }}>
            <span className={`badge ${STATUS_COLORS[invoice.status] ?? "badge-gray"}`} style={{ textTransform: "capitalize" }}>
              {invoice.status}
            </span>
            {customer && <span style={{ fontSize: "0.8125rem", color: "#78716c" }}>· {customer.name}</span>}
          </div>
        </div>
        <InvoiceActions
          invoiceId={id}
          status={invoice.status}
          orderId={order?.id ?? null}
          templateId={invoiceTemplateId}
          tenantDefaultTemplate={tenantDefaultTemplate}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
        {/* Invoice details */}
        <div className="card">
          <h3 style={{ fontSize: "0.75rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 0.875rem" }}>Invoice Details</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {[
              ["Invoice Date", new Date(invoice.invoice_date).toLocaleDateString("en-AU", { day:"numeric", month:"long", year:"numeric" })],
              ["Due Date", invoice.due_date ? new Date(invoice.due_date).toLocaleDateString("en-AU", { day:"numeric", month:"long", year:"numeric" }) : "—"],
              ["Currency", invoice.currency],
              ["Customer PO", order?.customer_po_number ?? "—"],
              ["Source Order", order ? order.order_number : "—"],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem" }}>
                <span style={{ color: "#78716c" }}>{label}</span>
                <span style={{ fontWeight: 500, color: "#1c1917" }}>{String(value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bill to */}
        <div className="card">
          <h3 style={{ fontSize: "0.75rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 0.875rem" }}>Bill To</h3>
          {customer ? (
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.25rem" }}>{String(customer.name ?? "")}</div>
              {customer.abn && <div style={{ fontSize: "0.8125rem", color: "#78716c" }}>ABN: {customer.abn}</div>}
              {customer.billing_address_line1 && <div style={{ fontSize: "0.8125rem", color: "#78716c", marginTop: "0.375rem" }}>{String(customer.billing_address_line1 ?? "")}</div>}
              {customer.billing_address_line2 && <div style={{ fontSize: "0.8125rem", color: "#78716c" }}>{String(customer.billing_address_line2 ?? "")}</div>}
              {(customer.billing_city || customer.billing_state || customer.billing_postcode) && (
                <div style={{ fontSize: "0.8125rem", color: "#78716c" }}>
                  {[customer.billing_city, customer.billing_state, customer.billing_postcode].filter(Boolean).join(" ")}
                </div>
              )}
              {customer.email && <div style={{ fontSize: "0.8125rem", color: "#78716c", marginTop: "0.25rem" }}>{String(customer.email ?? "")}</div>}
              {customer.phone && <div style={{ fontSize: "0.8125rem", color: "#78716c" }}>{String(customer.phone ?? "")}</div>}
            </div>
          ) : <p style={{ color: "#a8a29e", fontSize: "0.875rem" }}>No customer linked.</p>}
        </div>
      </div>

      {/* Line items */}
      <div className="card" style={{ padding: 0, marginBottom: "1.5rem" }}>
        <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4" }}>
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>Line Items</h3>
        </div>
        {lines.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "#78716c", fontSize: "0.875rem" }}>
            No line items found. <Link href={`/orders/${order?.id}`} style={{ color: "#b91c1c" }}>View source order →</Link>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>Item</th><th>Qty (units)</th><th>Qty (kg)</th>
                <th>Unit Price</th><th style={{ textAlign: "right" }}>Line Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.id}>
                  <td style={{ color: "#78716c" }}>{l.line_number}</td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{l.item?.name ?? "—"}</div>
                    <div style={{ fontSize: "0.75rem", color: "#78716c", fontFamily: "monospace" }}>{l.item?.code}</div>
                  </td>
                  <td>{l.qty_units ?? "—"}</td>
                  <td>{l.qty_kg != null ? `${l.qty_kg} kg` : "—"}</td>
                  <td>{l.unit_price != null ? `$${l.unit_price.toFixed(2)}` : "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>
                    {l.line_total != null ? `$${l.line_total.toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Totals */}
      <div className="card" style={{ maxWidth: "340px", marginLeft: "auto" }}>
        {[
          ["Subtotal", `$${(invoice.subtotal ?? 0).toFixed(2)}`],
          ["GST (10%)", `$${(invoice.tax_total ?? 0).toFixed(2)}`],
        ].map(([label, value]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "0.375rem 0", fontSize: "0.875rem" }}>
            <span style={{ color: "#78716c" }}>{label}</span>
            <span style={{ fontFamily: "monospace", color: "#1c1917" }}>{value}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "0.625rem 0 0.25rem", borderTop: "1px solid #e7e5e4", marginTop: "0.375rem" }}>
          <span style={{ fontWeight: 700, color: "#1c1917" }}>Total</span>
          <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#1c1917", fontSize: "1.0625rem" }}>
            ${(invoice.total ?? (invoice.subtotal ?? 0) + (invoice.tax_total ?? 0)).toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}