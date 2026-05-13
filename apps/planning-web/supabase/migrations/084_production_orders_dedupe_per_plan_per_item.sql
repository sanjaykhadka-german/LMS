-- ============================================================
-- Migration 084 — One active production order per (plan, item)
-- ============================================================
--
-- Background:
--   generateProductionOrders dedupes existing orders by (demand_plan, item).
--   When called with a deptFilter, the existing-orders fetch was filtered by
--   department too, which broke dedup whenever an item's effective dept
--   differed from the deptFilter (e.g. items.department NULL → mrp_results
--   falls back to item_type "wip", but the operator clicked Generate inside
--   the Production modal with deptFilter="production"). Net result: a second
--   production_order row got inserted instead of the existing one being
--   updated.
--
--   Migration 082 also dropped the unique(tenant_id, batch_number) constraint
--   to allow family-mates to share a batch number — which removed the only
--   incidental backstop that would have caught this duplication.
--
-- This migration installs the missing backstop: a partial unique index on
-- (demand_plan_id, item_id) that excludes cancelled rows. Catches any future
-- regression in the dedup logic at insert time. Cancel-then-regenerate cycles
-- still work because cancelled rows are excluded from the index predicate.
--
-- Note on the predicate: we use the enum literal (status <> 'cancelled'::order_status)
-- rather than a text cast (status::text != 'cancelled') because Postgres
-- requires index predicate functions to be IMMUTABLE, and enum-to-text cast
-- isn't.
--
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_production_orders_plan_item_active
  ON public.production_orders (demand_plan_id, item_id)
  WHERE status <> 'cancelled'::order_status;

COMMENT ON INDEX public.uq_production_orders_plan_item_active IS
  'At most one non-cancelled production_order per (demand_plan_id, item_id). Defense-in-depth against generateProductionOrders dedup bugs (e.g. items.department null causing dept mismatch).';
