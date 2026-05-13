CREATE TABLE "sc_shift_swap_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"initiator_user_id" uuid NOT NULL,
	"initiator_assignment_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"target_assignment_id" uuid,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_swap_status_chk" CHECK ("sc_shift_swap_requests"."status" in ('pending','accepted','declined','cancelled')),
	CONSTRAINT "sc_swap_distinct_users_chk" CHECK ("sc_shift_swap_requests"."initiator_user_id" <> "sc_shift_swap_requests"."target_user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sc_swap_pending_unique" ON "sc_shift_swap_requests" USING btree ("initiator_assignment_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "sc_swap_tenant_idx" ON "sc_shift_swap_requests" USING btree ("tracey_tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "sc_swap_target_idx" ON "sc_shift_swap_requests" USING btree ("target_user_id","status");