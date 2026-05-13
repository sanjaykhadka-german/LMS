import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const supabase = await createClient();

  // Fetch order + lines
  const { data: order, error: orderErr } = await supabase
    .from("customer_orders")
    .select(`*, lines:customer_order_lines(id, qty_units, qty_kg, unit_price, line_total)`)
    .eq("id", orderId)
    .single();

  if (orderErr || !order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.status !== "dispatched") return NextResponse.json({ error: "Only dispatched orders can be invoiced" }, { status: 400 });

  // Check no invoice exists yet
  const { data: existing } = await supabase
    .from("invoices")
    .select("id, invoice_number")
    .eq("customer_order_id", orderId)
    .maybeSingle();
  if (existing) return NextResponse.json({ error: "Invoice already exists", invoiceId: existing.id }, { status: 409 });

  // Calculate totals
  const lines = (order.lines ?? []) as { line_total: number | null }[];
  const subtotal = lines.reduce((sum, l) => sum + (l.line_total ?? 0), 0);
  const taxRate  = 0.10; // 10% GST
  const taxTotal = Math.round(subtotal * taxRate * 100) / 100;
  const total    = Math.round((subtotal + taxTotal) * 100) / 100;

  // Generate invoice number: INV-YYYYMM-NNNN
  const { count } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", order.tenant_id);
  const seq = String((count ?? 0) + 1).padStart(4, "0");
  const yyyymm = new Date().toISOString().slice(0, 7).replace("-", "");
  const invoiceNumber = `INV-${yyyymm}-${seq}`;

  // Due date = today + 30 days
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);

  const { data: { user } } = await supabase.auth.getUser();

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .insert({
      tenant_id: order.tenant_id,
      customer_id: order.customer_id,
      customer_order_id: orderId,
      invoice_number: invoiceNumber,
      invoice_date: new Date().toISOString().slice(0, 10),
      due_date: dueDate.toISOString().slice(0, 10),
      status: "draft",
      currency: order.currency ?? "AUD",
      subtotal,
      tax_total: taxTotal,
      total,
      created_by: user?.id,
    })
    .select("id, invoice_number")
    .single();

  if (invErr || !invoice) return NextResponse.json({ error: invErr?.message ?? "Failed to create invoice" }, { status: 500 });

  // Advance order to "invoiced"
  await supabase.from("customer_orders").update({ status: "invoiced" }).eq("id", orderId);

  return NextResponse.json({ invoiceId: invoice.id, invoiceNumber: invoice.invoice_number });
}
