-- ============================================================================
-- 077  PRODUCTION_ORDERS.PUBLISHED_AT — per-dept publish gate
-- ----------------------------------------------------------------------------
-- The new planning workflow lets the operator schedule orders by department
-- via drag-drop, then publish each dept INDEPENDENTLY when it's ready (rather
-- than locking the whole plan in one shot). The floor screens
-- (Production / Filling / Packing / Labelling) filter on published_at IS NOT
-- NULL so unpublished orders stay invisible to the floor while the planner
-- iterates.
--
-- Pre-existing orders (created before this migration) are stamped with
-- published_at = locked_at of their plan, so previously-locked plans keep
-- behaving as if their orders were published — no surprise blackout on the
-- floor screens after deploy.
-- ============================================================================

alter table public.production_orders
  add column if not exists published_at timestamptz;

comment on column public.production_orders.published_at is
  'When this order became visible on the floor. Null = scheduled-but-not-yet-published. Floor screens filter on IS NOT NULL.';

-- Backfill: any existing planned/in_progress/completed order on a locked plan
-- is treated as already published. Cancelled stays unpublished (no floor view).
update public.production_orders po
set published_at = coalesce(p.locked_at, po.created_at)
from public.demand_plans p
where po.demand_plan_id = p.id
  and po.published_at is null
  and po.status <> 'cancelled'
  and p.locked_at is not null;

create index if not exists idx_production_orders_published_at
  on public.production_orders(published_at)
  where published_at is not null;
