import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  // Verify order is in draft status
  const { data: order } = await supabase
    .from("customer_orders")
    .select(`
      status, order_number,
      customer:customer_id(name, email)
    `)
    .eq("id", id)
    .single();

  if (!order || order.status !== "draft") {
    return NextResponse.json({ error: "Order cannot be confirmed" }, { status: 400 });
  }

  // Advance status to confirmed
  const { error: updateErr } = await supabase
    .from("customer_orders")
    .update({ status: "confirmed" })
    .eq("id", id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Optionally send email
  const body = await request.json().catch(() => ({}));
  const recipients: string[] = body.recipients ?? [];
  let emailResult: { sent: boolean; error?: string } = { sent: false };

  if (recipients.length > 0) {
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "orders@germanbutchery.com.au";

    if (!resendKey) {
      emailResult = { sent: false, error: "RESEND_API_KEY not configured — order confirmed but email not sent." };
    } else {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(resendKey);

        const customer = Array.isArray(order.customer) ? order.customer[0] : order.customer;
        const customerName = (customer as { name?: string })?.name ?? "Customer";

        await resend.emails.send({
          from: fromEmail,
          to: recipients,
          subject: `Order #${order.order_number} Confirmed — German Butchery`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: #b91c1c; padding: 24px 32px; border-radius: 8px 8px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 22px;">Order Confirmed</h1>
                <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0; font-size: 14px;">German Butchery</p>
              </div>
              <div style="background: #fff; padding: 24px 32px; border: 1px solid #e7e5e4; border-top: none; border-radius: 0 0 8px 8px;">
                <p style="margin: 0 0 16px; font-size: 16px;">Hi ${customerName},</p>
                <p style="margin: 0 0 16px; color: #44403c;">
                  Your order <strong>#${order.order_number}</strong> has been confirmed and is now being prepared for dispatch.
                </p>
                <p style="margin: 0 0 24px; color: #44403c;">
                  If you have any questions or need to make changes, please contact us as soon as possible.
                </p>
                <p style="margin: 0; color: #78716c; font-size: 13px;">
                  — German Butchery Team
                </p>
              </div>
            </div>
          `,
        });
        emailResult = { sent: true };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        emailResult = { sent: false, error: `Email failed: ${msg}` };
      }
    }
  }

  return NextResponse.json({ ok: true, emailResult });
}
