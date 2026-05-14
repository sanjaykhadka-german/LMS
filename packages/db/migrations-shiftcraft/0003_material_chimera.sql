CREATE TABLE "sc_clock_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"app_user_id" uuid NOT NULL,
	"location_id" uuid,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_clock_events_type_chk" CHECK ("sc_clock_events"."event_type" in ('in','out','break_start','break_end')),
	CONSTRAINT "sc_clock_events_source_chk" CHECK ("sc_clock_events"."source" in ('manual','kiosk','geofence','admin_edit'))
);
--> statement-breakpoint
ALTER TABLE "sc_clock_events" ADD CONSTRAINT "sc_clock_events_app_user_id_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sc_clock_events_user_occurred_idx" ON "sc_clock_events" USING btree ("app_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sc_clock_events_tenant_occurred_idx" ON "sc_clock_events" USING btree ("tracey_tenant_id","occurred_at");