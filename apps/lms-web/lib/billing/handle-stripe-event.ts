import "server-only";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import {
  db,
  tenants,
  processedStripeEvents,
  type Tenant,
} from "@tracey/db";
import { planFromPrice, statusFromStripe } from "./plan";
import { logAuditEvent } from "~/lib/audit";

export interface HandleResult {
  status: "processed" | "duplicate" | "ignored" | "missing_tenant";
  tenantId?: Tenant["id"];
  type: string;
}

/**
 * Apply a verified Stripe webhook event to the tenant table.
 *
 * Idempotent: an `event.id` already present in `processed_stripe_events` is a
 * no-op and returns `duplicate`. Otherwise the row is recorded *first* (so a
 * subsequent failure doesn't double-process), then the event is applied.
 *
 * Pure-ish: takes the parsed event in, mutates rows. No HTTP. Easy to test.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<HandleResult> {
  const inserted = await db
    .insert(processedStripeEvents)
    .values({ eventId: event.id, type: event.type })
    .onConflictDoNothing({ target: processedStripeEvents.eventId })
    .returning({ id: processedStripeEvents.eventId });
  if (inserted.length === 0) {
    return { status: "duplicate", type: event.type };
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const tenantId = session.client_reference_id;
      if (!tenantId) return { status: "missing_tenant", type: event.type };
      await db
        .update(tenants)
        .set({
          stripeCustomerId:
            typeof session.customer === "string" ? session.customer : null,
          stripeSubscriptionId:
            typeof session.subscription === "string" ? session.subscription : null,
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tenantId));
      await logAuditEvent({
        tenantId,
        action: "subscription.changed",
        targetKind: "tenant",
        targetId: tenantId,
        details: { stripe_event: event.type, status: "active" },
      });
      return { status: "processed", tenantId, type: event.type };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : null;
      if (!customerId) return { status: "missing_tenant", type: event.type };
      const item = sub.items.data[0];
      const plan = planFromPrice(item?.price);
      const seats = item?.quantity ?? 0;
      // Stripe reports a pending cancellation as `status=active` +
      // `cancel_at_period_end=true` until the period ends, then fires
      // `customer.subscription.deleted`. Mirror both flags so the dashboard
      // can warn before the grace window expires.
      const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
      const canceledAt = sub.canceled_at ? new Date(sub.canceled_at * 1000) : null;
      const result = await db
        .update(tenants)
        .set({
          stripeSubscriptionId: sub.id,
          plan,
          status: statusFromStripe(sub.status),
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd,
          canceledAt,
          seatsPurchased: seats,
          updatedAt: new Date(),
        })
        .where(eq(tenants.stripeCustomerId, customerId))
        .returning({ id: tenants.id });
      const updated = result[0];
      if (!updated) return { status: "missing_tenant", type: event.type };
      await logAuditEvent({
        tenantId: updated.id,
        action: "subscription.changed",
        targetKind: "tenant",
        targetId: updated.id,
        details: {
          stripe_event: event.type,
          plan,
          status: statusFromStripe(sub.status),
          seats,
          cancel_at_period_end: cancelAtPeriodEnd,
        },
      });
      return { status: "processed", tenantId: updated.id, type: event.type };
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : null;
      if (!customerId) return { status: "missing_tenant", type: event.type };
      const canceledAt = sub.canceled_at
        ? new Date(sub.canceled_at * 1000)
        : new Date();
      const result = await db
        .update(tenants)
        .set({
          status: "canceled",
          cancelAtPeriodEnd: false,
          canceledAt,
          updatedAt: new Date(),
        })
        .where(eq(tenants.stripeCustomerId, customerId))
        .returning({ id: tenants.id });
      const updated = result[0];
      if (updated) {
        await logAuditEvent({
          tenantId: updated.id,
          action: "subscription.changed",
          targetKind: "tenant",
          targetId: updated.id,
          details: { stripe_event: event.type, status: "canceled" },
        });
      }
      return { status: "processed", type: event.type };
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
      if (!customerId) return { status: "missing_tenant", type: event.type };
      const result = await db
        .update(tenants)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(tenants.stripeCustomerId, customerId))
        .returning({ id: tenants.id });
      const updated = result[0];
      if (updated) {
        await logAuditEvent({
          tenantId: updated.id,
          action: "subscription.changed",
          targetKind: "tenant",
          targetId: updated.id,
          details: { stripe_event: event.type, status: "active" },
        });
      }
      return { status: "processed", type: event.type };
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
      if (!customerId) return { status: "missing_tenant", type: event.type };
      const result = await db
        .update(tenants)
        .set({ status: "past_due", updatedAt: new Date() })
        .where(eq(tenants.stripeCustomerId, customerId))
        .returning({ id: tenants.id });
      const updated = result[0];
      if (updated) {
        await logAuditEvent({
          tenantId: updated.id,
          action: "subscription.changed",
          targetKind: "tenant",
          targetId: updated.id,
          details: { stripe_event: event.type, status: "past_due" },
        });
      }
      return { status: "processed", type: event.type };
    }

    default:
      return { status: "ignored", type: event.type };
  }
}
