ALTER TABLE "sc_employees" ADD COLUMN "hourly_rate" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "sc_locations" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "sc_locations" ADD CONSTRAINT "sc_locations_color_chk" CHECK ("sc_locations"."color" is null or "sc_locations"."color" ~* '^#[0-9a-f]{6}$');