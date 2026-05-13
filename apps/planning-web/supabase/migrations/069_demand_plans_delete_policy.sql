-- ============================================================================
-- 069  DEMAND PLANS — delete policy (admins only can delete draft plans)
-- ----------------------------------------------------------------------------
-- The original 001_initial.sql migration set up RLS for demand_plans with
-- select / insert / update policies but no delete policy, so DELETEs were
-- silently denied for everyone (RLS-deny default). This adds a policy that
-- lets admins delete plans, gated to status='draft' so a committed/locked
-- plan can never be wiped accidentally.
--
-- Why admin-only: deleting a draft plan is destructive (cascades down to
-- demand_lines and mrp_results) and there's no undo. Per-tenant manager and
-- planner roles can still build / edit / lock / reopen plans; only admins
-- can wipe them. Matches the pattern used elsewhere (items_delete in 001,
-- packaging_specs_delete in 005, etc).
--
-- demand_lines and mrp_results already have ON DELETE CASCADE foreign keys
-- (see 001_initial.sql lines 274 + 300), so deleting the plan also tears
-- down its lines and MRP results.
--
-- production_orders.demand_plan_id is a plain reference (no cascade). For
-- draft plans there should be zero production_orders since those are only
-- created when status flips to 'locked' via generateProductionOrders. The
-- WHERE-clause guard below enforces this at the DB level: a delete is only
-- allowed while status='draft', which is mutually exclusive with having
-- generated orders.
-- ============================================================================

create policy "demand_plans_delete" on demand_plans
  for delete
  using (
    tenant_id = my_tenant_id()
    and is_admin_or_above()
    and status = 'draft'
  );
