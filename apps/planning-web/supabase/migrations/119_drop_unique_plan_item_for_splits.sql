-- The unique index uq_production_orders_plan_item_active was added in
-- migration 084 as defense-in-depth against generateProductionOrders dedup
-- bugs (where dept-matching could accidentally create two orders for the
-- same item). That made sense when one order per (plan, item) was the rule.
--
-- The split-order feature (Tino, 2026-05-10) intentionally creates multiple
-- production_orders for the same (plan, item) — one per split day. So this
-- constraint blocks splits. Drop it.
--
-- Dedup protection for generateProductionOrders is now the responsibility
-- of the function itself (idempotent upserts keyed off batch_number).

DROP INDEX IF EXISTS uq_production_orders_plan_item_active;

COMMENT ON TABLE production_orders IS
  'Production work orders. Multiple rows per (demand_plan_id, item_id) are now allowed — they represent splits across days. Dedup is enforced inside generateProductionOrders via batch_number tracking, not via unique index.';
