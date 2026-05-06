CREATE SCHEMA IF NOT EXISTS "app";
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'trialing' NOT NULL,
	"trial_ends_at" timestamp with time zone DEFAULT (now() + interval '24 days') NOT NULL,
	"current_period_end" timestamp with time zone,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"seats_purchased" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_plan_chk" CHECK ("plan" in ('free','starter','pro','enterprise')),
	CONSTRAINT "tenants_status_chk" CHECK ("status" in ('trialing','active','past_due','canceled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_clerk_org_id_uq" ON "app"."tenants" USING btree ("clerk_org_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_stripe_customer_id_uq" ON "app"."tenants" USING btree ("stripe_customer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_stripe_subscription_id_uq" ON "app"."tenants" USING btree ("stripe_subscription_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."processed_stripe_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
