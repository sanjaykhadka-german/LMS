CREATE TABLE "sc_shift_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"shift_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sc_shift_comments" ADD CONSTRAINT "sc_shift_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sc_shift_comments_shift_created_idx" ON "sc_shift_comments" USING btree ("shift_id","created_at");--> statement-breakpoint
CREATE INDEX "sc_shift_comments_tenant_idx" ON "sc_shift_comments" USING btree ("tracey_tenant_id");