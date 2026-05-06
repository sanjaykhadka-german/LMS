CREATE SCHEMA IF NOT EXISTS "app";
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_uq" ON "app"."users" USING btree ("email");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	PRIMARY KEY ("provider", "provider_account_id"),
	FOREIGN KEY ("user_id") REFERENCES "app"."users" ("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "app"."users" ("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	PRIMARY KEY ("identifier", "token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
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
	CONSTRAINT "tenants_status_chk" CHECK ("status" in ('trialing','active','past_due','canceled')),
	FOREIGN KEY ("owner_user_id") REFERENCES "app"."users" ("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_stripe_customer_id_uq" ON "app"."tenants" USING btree ("stripe_customer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_stripe_subscription_id_uq" ON "app"."tenants" USING btree ("stripe_subscription_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_role_chk" CHECK ("role" in ('owner','admin','member')),
	FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants" ("id") ON DELETE CASCADE,
	FOREIGN KEY ("user_id") REFERENCES "app"."users" ("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "members_tenant_user_uq" ON "app"."members" USING btree ("tenant_id", "user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_role_chk" CHECK ("role" in ('owner','admin','member')),
	FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants" ("id") ON DELETE CASCADE,
	FOREIGN KEY ("invited_by_user_id") REFERENCES "app"."users" ("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invitations_token_uq" ON "app"."invitations" USING btree ("token");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."processed_stripe_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
