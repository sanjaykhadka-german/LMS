import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const appSchema = pgSchema("app");

export const tenants = appSchema.table(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clerkOrgId: text("clerk_org_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    plan: text("plan").notNull().default("free"),
    status: text("status").notNull().default("trialing"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '14 days'`),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    seatsPurchased: integer("seats_purchased").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tenants_clerk_org_id_uq").on(t.clerkOrgId),
    uniqueIndex("tenants_slug_uq").on(t.slug),
    uniqueIndex("tenants_stripe_customer_id_uq").on(t.stripeCustomerId),
    uniqueIndex("tenants_stripe_subscription_id_uq").on(t.stripeSubscriptionId),
    check("tenants_plan_chk", sql`${t.plan} in ('free','starter','pro','enterprise')`),
    check(
      "tenants_status_chk",
      sql`${t.status} in ('trialing','active','past_due','canceled')`,
    ),
  ],
);

export const processedStripeEvents = appSchema.table("processed_stripe_events", {
  eventId: text("event_id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type ProcessedStripeEvent = typeof processedStripeEvents.$inferSelect;
