-- ============================================================================
-- 054  PLANNING — date allocation + plan lock + idempotent generate
-- ----------------------------------------------------------------------------
-- Adds the columns needed for the new planning workflow:
--   1. mrp_results.scheduled_date  → operator drags MRP items onto Mon..Sun
--      in the dept modal; this column captures the allocation.
--   2. demand_plans.locked_at / reopened_at  → audit timestamps for the
--      lock/reopen flow (status column still drives behaviour).
--   3. production_orders.last_synced_at  → set by Generate Orders so we
--      know which rows were touched by the last sync (used by idempotent
--      reconciliation when the plan is re-opened + re-generated).
-- ============================================================================

ALTER TABLE public.mrp_results
  ADD COLUMN IF NOT EXISTS scheduled_date date;

CREATE INDEX IF NOT EXISTS idx_mrp_results_scheduled_date
  ON public.mrp_results(scheduled_date)
  WHERE scheduled_date IS NOT NULL;

ALTER TABLE public.demand_plans
  ADD COLUMN IF NOT EXISTS locked_at   timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

-- Quick lookup for "find existing orders for this plan + item" during
-- idempotent regeneration. Partial: only orders linked to a plan.
CREATE INDEX IF NOT EXISTS idx_production_orders_plan_item
  ON public.production_orders(demand_plan_id, item_id)
  WHERE demand_plan_id IS NOT NULL;
