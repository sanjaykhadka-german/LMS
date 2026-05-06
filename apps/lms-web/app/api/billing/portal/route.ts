import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { currentTenant } from "@tracey/auth";
import { stripe } from "~/lib/stripe";
import { siteConfig } from "~/lib/site-config";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "no active organisation" }, { status: 400 });
  }
  if (!tenant.stripeCustomerId) {
    return NextResponse.json(
      { error: "no Stripe customer — subscribe first" },
      { status: 400 },
    );
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: tenant.stripeCustomerId,
    return_url: `${siteConfig.url}/app`,
  });
  return NextResponse.redirect(portal.url, { status: 303 });
}
