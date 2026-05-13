import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const NEXT_STATUS: Record<string, string> = {
  draft: "confirmed",
  confirmed: "dispatched",
  dispatched: "invoiced",
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("customer_orders")
    .select("status")
    .eq("id", id)
    .single();

  if (order && NEXT_STATUS[order.status]) {
    await supabase
      .from("customer_orders")
      .update({ status: NEXT_STATUS[order.status] })
      .eq("id", id);
  }

  redirect(`/orders/${id}`);
}
