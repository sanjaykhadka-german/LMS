CREATE TABLE "sc_email_unsubscribes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"app_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sc_email_unsubscribes" ADD CONSTRAINT "sc_email_unsubscribes_app_user_id_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sc_email_unsubscribes_uq" ON "sc_email_unsubscribes" USING btree ("tracey_tenant_id","app_user_id","kind");--> statement-breakpoint
CREATE INDEX "sc_email_unsubscribes_kind_idx" ON "sc_email_unsubscribes" USING btree ("tracey_tenant_id","kind");