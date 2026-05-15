CREATE TABLE "sc_shift_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"location_id" uuid NOT NULL,
	"role" text NOT NULL,
	"start_hour" integer NOT NULL,
	"start_minute" integer DEFAULT 0 NOT NULL,
	"end_hour" integer NOT NULL,
	"end_minute" integer DEFAULT 0 NOT NULL,
	"default_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_shift_templates_start_hour_chk" CHECK ("sc_shift_templates"."start_hour" between 0 and 23),
	CONSTRAINT "sc_shift_templates_end_hour_chk" CHECK ("sc_shift_templates"."end_hour" between 0 and 23),
	CONSTRAINT "sc_shift_templates_start_minute_chk" CHECK ("sc_shift_templates"."start_minute" in (0, 15, 30, 45)),
	CONSTRAINT "sc_shift_templates_end_minute_chk" CHECK ("sc_shift_templates"."end_minute" in (0, 15, 30, 45))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sc_shift_templates_tenant_name_uq" ON "sc_shift_templates" USING btree ("tracey_tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "sc_shift_templates_tenant_idx" ON "sc_shift_templates" USING btree ("tracey_tenant_id");