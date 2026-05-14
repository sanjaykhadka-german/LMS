CREATE TABLE "sc_employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"app_user_id" uuid,
	"full_name" text NOT NULL,
	"email" text,
	"mobile" text,
	"department" text,
	"availability" jsonb,
	"employment_type" text DEFAULT 'permanent' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_employees_employment_type_chk" CHECK ("sc_employees"."employment_type" in ('permanent','casual','labour_hire')),
	CONSTRAINT "sc_employees_email_format_chk" CHECK ("sc_employees"."email" is null or position('@' in "sc_employees"."email") > 1)
);
--> statement-breakpoint
ALTER TABLE "sc_employees" ADD CONSTRAINT "sc_employees_app_user_id_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_employees" ADD CONSTRAINT "sc_employees_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sc_employees_tenant_idx" ON "sc_employees" USING btree ("tracey_tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "sc_employees_app_user_idx" ON "sc_employees" USING btree ("app_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sc_employees_tenant_email_uq" ON "sc_employees" USING btree ("tracey_tenant_id",lower("email")) WHERE "sc_employees"."email" is not null;