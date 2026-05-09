-- Drizzle-tracked migration: add cancellation tracking columns to tenants.
--
-- Note: drizzle-kit also detected `ai_studio_sessions` as missing from its
-- previous snapshot because that table was created via the manual migration
-- packages/db/migrations/manual/0004_ai_studio_sessions.sql before being
-- declared in schema.ts (the documented "Drizzle snapshot gotcha"). Those
-- regenerated CREATE/INDEX/FK statements are intentionally stripped here so
-- this migration is safe to apply against any DB where 0004_ai_studio_sessions
-- has already run.
--
-- The 0004 snapshot in meta/ now reflects reality (schema.ts) and future
-- migrations will diff cleanly from it.

ALTER TABLE "app"."tenants" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."tenants" ADD COLUMN "canceled_at" timestamp with time zone;
