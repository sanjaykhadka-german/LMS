ALTER TABLE "sc_announcements" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sc_announcements" ADD COLUMN "emailed_recipient_count" integer;