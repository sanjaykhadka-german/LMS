export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BackButton } from "@/components/back-button";
import { QuickNav } from "@/components/quick-nav";
import { ITEM_TYPE_LABELS, ITEM_TYPE_COLORS, type ItemType } from "@/lib/types";
import GenerateInvoiceButton from "./_components/generate-invoice-button";
import ConfirmOrderButton from "./_components/confirm-order-button";

const STATUS_COLORS: Record<string, string> = {
  draft: "badge-gray", confirmed: "badge-blue",
  dispatched: "badge-green", invoiced: "badge-gray", cancelled: "badge-red",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", confirmed: "Confirmed",
  dispatched: "Dispatched", invoiced: "Invoiced", cancelled: "Cancelled",
};

const NEXT_STATUS: Record<string, string> = {
  draft: "confirmed",
  confirmed: "dispatched",
};

type OrderLine = {
  id: string;
  line_number: number;
  order_uom: string | null;
  qty_ordered: number | null;
  qty_inners: number | null;
  qty_kg_estimated: number | null;
  unit_price: number | null;
  notes: string | null;
  item: {
    id: string; code: string; name: string;
    item_type: string; unit: string;
    weight_mode: string | null;
    target_weight_g: number | null;
    units_per_inner: number | null;
    inner_per_outer: number | null;
  } | null;
};

function lineEstimatedTotal(line: OrderLine): { value: number | null; estimated: boolean } {
  const qty = line.qty_ordered;
  const price = line.unit_price;
  const item = line.item;
  if (!qty || !price || !item) return { value: null, estimated: false };

  if (item.weight_mode === "fixed") {
    return { value: qty * price, estimated: false };
  }

  if (item.weight_mode === "random") {
    if (line.order_uom === "kg") return { value: qty * price, estimated: false };
    if (line.order_uom === "carton") {
      const innerPerCarton = item.inner_per_outer ?? 1;
      const unitsPerInner = item.units_per_inner ?? 1;
      const avgWeightG = item.target_weight_g ?? 0;
      if (avgWeightG > 0) {
        const kgPerCarton = (innerPerCarton * unitsPerInner * avgWeightG) / 1000;
        return { value: qty * kgPerCarton * price, estimated: true };
      }
      return { value: null, estimated: true };
    }
  }

  return { value: qty * price, estimated: false };
}

function uomLabel(uom: string | null): string {
  if (!uom) return "";
  return ({ inner: "inner", carton: "ctn", kg: "kg" } as Record<string, string>)[uom] ?? uom;
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("customer_orders")
    .select(`
      *,
      customer:customer_id(id, code, name, email, phone, delivery_instructions),
      lines:customer_order_lines(
        id, line_number, order_uom, qty_ordered, qty_inners, qty_kg_estimated, unit_price, notes,
        item:item_id(id, code, name, item_type, unit, weight_mode, target_weight_g, units_per_inner, inner_per_outer)
      )
    `)
    .eq("id", id)
    .single();

  if (!order) notFound();

  const customer = order.customer as {
    id: string; code: string; name: string; email: string | null;
    phone: string | null; delivery_instructions: string | null;
  } | null;

  const lines = ((order.lines ?? []) as OrderLine[]).sort((a, b) => a.line_number - b.line_number);

  const hasEstimates = lines.some(l => lineEstimatedTotal(l).estimated);
  const orderTotal = lines.reduce((sum, l) => sum + (lineEstimatedTotal(l).value ?? 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <BackButton href="/orders" label="Orders" />
            <span style={{ color: "#d4d4d4" }}>|</span>
            <QuickNav />
          </div>
          <h1 className="page-title" style={{ marginTop: "0.375rem" }}>Order #{order.order_number}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginTop: "0.375rem" }}>
            <span className={`badge ${STATUS_COLORS[order.status] ?? "badge-gray"}`}>
              {STATUS_LABELS[order.status] ?? order.status}
            </span>
            {customer && <span style={{ fontSize: "0.8125rem", color: "#78716c" }}>&middot; {customer.name}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.625rem", alignItems: "flex-start" }}>
          <Link href={`/orders/${id}/edit`} className="btn-secondary">Edit Order</Link>
          {order.status === "draft" && (
            <ConfirmOrderButton
              orderId={id}
              orderNumber={order.order_number}
              customerName={customer?.name ?? null}
              customerEmail={customer?.email ?? null}
            />
          )}
          {order.status === "confirmed" && (
            <form action={`/api/orders/${id}/advance`} method="POST">
              <button type="submit" className="btn-primary" style={{ background: "#15803d", borderColor: "#15803d" }}>
                Mark as Dispatched &rarr;
              </button>
            </form>
          )}
          {order.status === "dispatched" && <GenerateInvoiceButton orderId={id} />}
          {order.status === "invoiced" && (
            <Link href="/invoices" className="btn-secondary">View Invoices &rarr;</Link>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        {/* Order info */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Order Details</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {[
                ["Order Number", `#${order.order_number}`],
                ["Customer PO", order.customer_po_number ?? "—"],
                ["Order Date", new Date(order.order_date).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })],
                ["Required Date", order.required_date ? new Date(order.required_date).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }) : "—"],
                ["Dispatch Date", order.delivery_date ? new Date(order.delivery_date).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }) : "—"],
                ["Currency", order.currency],
              ].map(([k, v]) => (
                <tr key={k} style={{ borderBottom: "1px solid #f5f5f4" }}>
                  <td style={{ padding: "0.4375rem 0", fontSize: "0.8125rem", color: "#78716c", width: "40%" }}>{k}</td>
                  <td style={{ padding: "0.4375rem 0", fontSize: "0.875rem", fontWeight: "500" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {order.notes && (
            <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "#fafaf9", borderRadius: "0.375rem", fontSize: "0.875rem", color: "#78716c" }}>
              {order.notes}
            </div>
          )}
        </div>

        {/* Customer info */}
        {customer && (
          <div className="card">
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>
              Customer &mdash;{" "}
              <Link href={`/customers/${customer.id}`} style={{ color: "#b91c1c", textDecoration: "none", fontWeight: 400 }}>
                {customer.name}
              </Link>
            </h2>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {[
                  ["Code", customer.code],
                  ["Email", customer.email ?? "—"],
                  ["Phone", customer.phone ?? "—"],
                  ["Delivery Notes", customer.delivery_instructions ?? "—"],
                ].map(([k, v]) => (
                  <tr key={k} style={{ borderBottom: "1px solid #f5f5f4" }}>
                    <td style={{ padding: "0.4375rem 0", fontSize: "0.8125rem", color: "#78716c", width: "40%" }}>{k}</td>
                    <td style={{ padding: "0.4375rem 0", fontSize: "0.875rem", fontWeight: k === "Code" ? "600" : "500", fontFamily: k === "Code" ? "monospace" : undefined }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Order lines */}
      <div className="card" style={{ marginTop: "1.5rem", padding: 0 }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Order Lines</h2>
          {hasEstimates && (
            <span style={{ fontSize: "0.75rem", color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "0.375rem", padding: "0.25rem 0.625rem" }}>
              ⚖️ Random weight — invoiced on actual dispatched kg
            </span>
          )}
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>Code</th>
              <th>Type</th>
              <th>Ordered</th>
              <th>Inners</th>
              <th>Est. kg</th>
              <th>Unit Price</th>
              <th>Est. Total</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(line => {
              const { value: total, estimated } = lineEstimatedTotal(line);
              const isRandom = line.item?.weight_mode === "random";
              return (
                <tr key={line.id}>
                  <td style={{ color: "#a8a29e", fontSize: "0.8125rem", textAlign: "center" }}>{line.line_number}</td>
                  <td style={{ fontWeight: 500 }}>
                    {line.item
                      ? <Link href={`/items/${line.item.id}`} style={{ textDecoration: "none", color: "inherit" }}>{line.item.name}</Link>
                      : "—"}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{line.item?.code ?? "—"}</td>
                  <td>
                    {line.item && (
                      <span className={`badge ${ITEM_TYPE_COLORS[line.item.item_type as ItemType]}`} style={{ fontSize: "0.625rem" }}>
                        {ITEM_TYPE_LABELS[line.item.item_type as ItemType]}
                      </span>
                    )}
                  </td>
                  <td>
                    {line.qty_ordered != null
                      ? <><span style={{ fontWeight: 500 }}>{line.qty_ordered}</span>{" "}<span style={{ color: "#78716c", fontSize: "0.75rem" }}>{uomLabel(line.order_uom)}</span></>
                      : "—"}
                  </td>
                  <td style={{ color: "#78716c" }}>{line.qty_inners ?? "—"}</td>
                  <td style={{ color: isRandom ? "#b45309" : "#78716c" }}>
                    {line.qty_kg_estimated != null
                      ? <>{isRandom ? "~" : ""}{line.qty_kg_estimated.toFixed(2)} kg</>
                      : "—"}
                  </td>
                  <td>
                    {line.unit_price != null
                      ? <>{order.currency} {line.unit_price.toFixed(2)}{isRandom && <span style={{ fontSize: "0.7rem", color: "#78716c" }}>/kg</span>}</>
                      : "—"}
                  </td>
                  <td style={{ fontWeight: 600, color: estimated ? "#b45309" : "inherit" }}>
                    {total != null ? <>{estimated ? "~" : ""}{order.currency} {total.toFixed(2)}</> : "—"}
                  </td>
                  <td style={{ color: "#78716c" }}>{line.notes ?? "—"}</td>
                </tr>
              );
            })}
            {orderTotal > 0 && (
              <tr style={{ background: "#fafaf9", fontWeight: 600 }}>
                <td colSpan={8} style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontSize: "0.8125rem", color: "#78716c" }}>
                  {hasEstimates ? "Estimated Order Total" : "Order Total"}
                </td>
                <td style={{ padding: "0.5rem 0.75rem", color: hasEstimates ? "#b45309" : "inherit" }}>
                  {hasEstimates ? "~" : ""}{order.currency} {orderTotal.toFixed(2)}
                </td>
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
