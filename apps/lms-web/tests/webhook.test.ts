import { describe, it, expect, beforeEach, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("@tracey/db", async () => await import("./fakes/db"));
vi.mock("drizzle-orm", async () => {
  const fake = await import("./fakes/db");
  return { eq: fake.eq, isNotNull: fake.isNotNull, sql: fake.sql };
});

import { handleStripeEvent } from "../lib/billing/handle-stripe-event";
import {
  resetFakeDb,
  seedTenant,
  getTenant,
  allTenants,
} from "./fakes/db";

function subscriptionEvent(
  type: "customer.subscription.created" | "customer.subscription.updated",
  overrides: Partial<{
    id: string;
    customerId: string;
    subId: string;
    plan: string;
    status: Stripe.Subscription.Status;
    currentPeriodEnd: number;
    seats: number;
  }> = {},
): Stripe.Event {
  const {
    id = `evt_${type}_${Math.random().toString(36).slice(2, 8)}`,
    customerId = "cus_123",
    subId = "sub_123",
    plan = "pro",
    status = "active",
    currentPeriodEnd = 1735689600, // 2025-01-01
    seats = 5,
  } = overrides;
  return {
    id,
    type,
    object: "event",
    api_version: "2024-12-18.acacia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: subId,
        object: "subscription",
        customer: customerId,
        status,
        current_period_end: currentPeriodEnd,
        items: {
          object: "list",
          data: [
            {
              id: "si_1",
              price: { id: "price_1", metadata: { plan } },
              quantity: seats,
            },
          ],
        },
      } as unknown as Stripe.Subscription,
    },
  } as Stripe.Event;
}

describe("handleStripeEvent — customer.subscription.updated", () => {
  beforeEach(() => {
    resetFakeDb();
    seedTenant({
      id: "tenant-1",
      clerkOrgId: "org_test",
      stripeCustomerId: "cus_123",
      plan: "free",
      status: "trialing",
    });
  });

  it("updates the tenant row to match the live subscription", async () => {
    const event = subscriptionEvent("customer.subscription.updated", {
      plan: "pro",
      status: "active",
      currentPeriodEnd: 1735689600,
      seats: 7,
    });

    const result = await handleStripeEvent(event);

    expect(result.status).toBe("processed");
    const t = getTenant("tenant-1");
    expect(t).toBeDefined();
    expect(t!.plan).toBe("pro");
    expect(t!.status).toBe("active");
    expect(t!.currentPeriodEnd).toEqual(new Date(1735689600 * 1000));
    expect(t!.seatsPurchased).toBe(7);
    expect(t!.stripeSubscriptionId).toBe("sub_123");
  });

  it("maps unusual Stripe statuses to past_due", async () => {
    const event = subscriptionEvent("customer.subscription.updated", {
      status: "incomplete",
    });
    await handleStripeEvent(event);
    expect(getTenant("tenant-1")!.status).toBe("past_due");
  });

  it("returns missing_tenant when no tenant matches the customer", async () => {
    const event = subscriptionEvent("customer.subscription.updated", {
      customerId: "cus_unknown",
    });
    const result = await handleStripeEvent(event);
    expect(result.status).toBe("missing_tenant");
  });
});

describe("handleStripeEvent — checkout.session.completed", () => {
  beforeEach(() => {
    resetFakeDb();
    seedTenant({
      id: "tenant-2",
      clerkOrgId: "org_test_2",
      plan: "free",
      status: "trialing",
    });
  });

  it("attaches Stripe customer/subscription IDs and flips status to active", async () => {
    const event = {
      id: "evt_checkout_1",
      type: "checkout.session.completed",
      object: "event",
      api_version: "2024-12-18.acacia",
      created: 0,
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      data: {
        object: {
          id: "cs_1",
          object: "checkout.session",
          client_reference_id: "tenant-2",
          customer: "cus_456",
          subscription: "sub_456",
        },
      },
    } as unknown as Stripe.Event;

    const result = await handleStripeEvent(event);

    expect(result.status).toBe("processed");
    const t = getTenant("tenant-2");
    expect(t!.stripeCustomerId).toBe("cus_456");
    expect(t!.stripeSubscriptionId).toBe("sub_456");
    expect(t!.status).toBe("active");
  });
});

describe("handleStripeEvent — invoice.payment_failed", () => {
  beforeEach(() => {
    resetFakeDb();
    seedTenant({
      id: "tenant-3",
      stripeCustomerId: "cus_789",
      status: "active",
    });
  });

  it("marks the tenant past_due", async () => {
    const event = {
      id: "evt_invoice_failed_1",
      type: "invoice.payment_failed",
      object: "event",
      api_version: "2024-12-18.acacia",
      created: 0,
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      data: { object: { object: "invoice", customer: "cus_789" } },
    } as unknown as Stripe.Event;

    await handleStripeEvent(event);
    expect(getTenant("tenant-3")!.status).toBe("past_due");
  });
});

describe("handleStripeEvent — unknown types", () => {
  beforeEach(() => resetFakeDb());

  it("records the event but ignores the body", async () => {
    const event = {
      id: "evt_unknown_1",
      type: "customer.created",
      object: "event",
      api_version: "2024-12-18.acacia",
      created: 0,
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      data: { object: { object: "customer" } },
    } as unknown as Stripe.Event;

    const result = await handleStripeEvent(event);
    expect(result.status).toBe("ignored");
    expect(allTenants()).toHaveLength(0);
  });
});
