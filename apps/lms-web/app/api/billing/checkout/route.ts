import { NextResponse, type NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { currentTenant } from "@tracey/auth";
import { stripe } from "~/lib/stripe";
import { siteConfig, priceIdFor } from "~/lib/site-config";
import type { Plan } from "@tracey/types";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "no active organisation" }, { status: 400 });
  }

  const form = await req.formData();
  const planRaw = form.get("plan");
  if (planRaw !== "starter" && planRaw !== "pro") {
    return NextResponse.json(
      { error: "plan must be 'starter' or 'pro'" },
      { status: 400 },
    );
  }
  const plan = planRaw as Plan;
  const priceId = priceIdFor(plan);
  if (!priceId) {
    return NextResponse.json(
      { error: `No Stripe price configured for ${plan}` },
      { status: 500 },
    );
  }

  const user = await currentUser();
  const customerEmail = user?.primaryEmailAddress?.emailAddress;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: tenant.id,
    customer: tenant.stripeCustomerId ?? undefined,
    customer_email: tenant.stripeCustomerId ? undefined : customerEmail,
    subscription_data: {
      trial_period_days: 14,
      metadata: { tenant_id: tenant.id, plan },
    },
    allow_promotion_codes: true,
    success_url: `${siteConfig.url}/app?checkout=success`,
    cancel_url: `${siteConfig.url}/app?checkout=cancelled`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "Stripe did not return a session URL" }, { status: 502 });
  }
  return NextResponse.redirect(session.url, { status: 303 });
}
