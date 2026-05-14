CREATE TABLE "sc_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sc_employees" ADD COLUMN "department_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "sc_departments_tenant_name_uq" ON "sc_departments" USING btree ("tracey_tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "sc_departments_tenant_idx" ON "sc_departments" USING btree ("tracey_tenant_id");--> statement-breakpoint
ALTER TABLE "sc_employees" ADD CONSTRAINT "sc_employees_department_id_sc_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."sc_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_employees" DROP COLUMN "department";