import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type LotPayload = {
  dispatch_uom: string;
  qty_dispatched: number;
  batch_number: string | null;
  use_by_date: string | null;
};

type LinePayload = {
  id: string;
  lots: LotPayload[];
  dispatch_uom: string | null;
  qty_dispatched: number | null;
  qty_kg_actual: number | null;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const body = await request.json() as {
    dispatch_date: string;
    lines: LinePayload[];
  };

  // Get tenant_id from the order (needed for lot inserts)
  const { data: order } = await supabase
    .from("customer_orders")
    .select("tenant_id")
    .eq("id", id)
    .single();

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const tenantId = order.tenant_id;

  // Process each order line
  for (const line of body.lines) {
    // Update summary columns on the order line
    await supabase
      .from("customer_order_lines")
      .update({
        dispatch_uom: line.dispatch_uom,
        qty_dispatched: line.qty_dispatched,
        qty_kg_actual: line.qty_kg_actual,
        // Legacy single lot_number: first batch for backward compat
        lot_number: line.lots[0]?.batch_number ?? null,
      })
      .eq("id", line.id);

    // Delete any existing lots (makes dispatch idempotent)
    await supabase.from("customer_order_line_lots").delete().eq("order_line_id", line.id);

    // Insert lot records
    const lotRecords = line.lots
      .filter(l => l.qty_dispatched > 0)
      .map(lot => ({
        tenant_id: tenantId,
        order_line_id: line.id,
        dispatch_uom: lot.dispatch_uom,
        qty_dispatched: lot.qty_dispatched,
        batch_number: lot.batch_number,
        use_by_date: lot.use_by_date,
      }));

    if (lotRecords.length > 0) {
      const { error: lotsErr } = await supabase
        .from("customer_order_line_lots")
        .insert(lotRecords);

      if (lotsErr) {
        return NextResponse.json({ error: `Lot insert failed: ${lotsErr.message}` }, { status: 500 });
      }
    }
  }

  // Advance order to dispatched + record dispatch date
  const { error } = await supabase
    .from("customer_orders")
    .update({ status: "dispatched", delivery_date: body.dispatch_date })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
