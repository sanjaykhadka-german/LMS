CREATE TABLE "sc_clock_event_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"clock_event_id" uuid NOT NULL,
	"image" "bytea",
	"mime_type" text,
	"selfie_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_clock_event_photos_status_chk" CHECK ("sc_clock_event_photos"."selfie_status" in ('captured','denied','unavailable'))
);
--> statement-breakpoint
CREATE TABLE "sc_employee_pins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"app_user_id" uuid NOT NULL,
	"pin_hash" text NOT NULL,
	"set_by_user_id" uuid,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sc_kiosk_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"label" text NOT NULL,
	"location_id" uuid NOT NULL,
	"pairing_code" text,
	"pairing_expires_at" timestamp with time zone,
	"paired_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"require_selfie" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sc_employee_pins" ADD CONSTRAINT "sc_employee_pins_app_user_id_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_employee_pins" ADD CONSTRAINT "sc_employee_pins_set_by_user_id_users_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_kiosk_devices" ADD CONSTRAINT "sc_kiosk_devices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sc_clock_event_photos_event_uq" ON "sc_clock_event_photos" USING btree ("tracey_tenant_id","clock_event_id");--> statement-breakpoint
CREATE INDEX "sc_clock_event_photos_tenant_idx" ON "sc_clock_event_photos" USING btree ("tracey_tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sc_employee_pins_tenant_user_uq" ON "sc_employee_pins" USING btree ("tracey_tenant_id","app_user_id");--> statement-breakpoint
CREATE INDEX "sc_kiosk_devices_tenant_idx" ON "sc_kiosk_devices" USING btree ("tracey_tenant_id","revoked_at");--> statement-breakpoint
CREATE INDEX "sc_kiosk_devices_location_idx" ON "sc_kiosk_devices" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sc_kiosk_devices_pairing_uq" ON "sc_kiosk_devices" USING btree ("tracey_tenant_id","pairing_code") WHERE "sc_kiosk_devices"."pairing_code" is not null;