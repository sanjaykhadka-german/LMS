CREATE TABLE "sc_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sc_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assignee_user_id" uuid,
	"location_id" uuid,
	"due_date" date,
	"created_by_user_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_tasks_status_chk" CHECK ("sc_tasks"."status" in ('open','in_progress','done')),
	CONSTRAINT "sc_tasks_priority_chk" CHECK ("sc_tasks"."priority" in ('low','normal','high','urgent'))
);
--> statement-breakpoint
ALTER TABLE "sc_announcements" ADD CONSTRAINT "sc_announcements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_tasks" ADD CONSTRAINT "sc_tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_tasks" ADD CONSTRAINT "sc_tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sc_announcements_tenant_pinned_idx" ON "sc_announcements" USING btree ("tracey_tenant_id","pinned","created_at");--> statement-breakpoint
CREATE INDEX "sc_tasks_tenant_status_idx" ON "sc_tasks" USING btree ("tracey_tenant_id","status");--> statement-breakpoint
CREATE INDEX "sc_tasks_assignee_idx" ON "sc_tasks" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "sc_tasks_due_idx" ON "sc_tasks" USING btree ("tracey_tenant_id","due_date");