-- ============================================================
-- Migration 083 — production_orders.machine_id FK + run_sequence
-- ============================================================
--
-- Background:
--   Today production_orders.machine is a free-text column (since
--   migration 001). The machines register (migration 011) is fully
--   built but not yet wired into production_orders, so an operator
--   can't reliably pick a real machine — and the dept day-view sorts
--   by `priority` which conflates urgency with "today's run order
--   on machine X".
--
-- This migration:
--
--   1. Adds production_orders.machine_id  uuid references machines(id)
--      Nullable. Legacy `machine` text column stays in place for
--      back-compat — UI will mirror the picked machine's name into
--      it on save, so existing reports keep working until the dust
--      settles.
--
--   2. Adds production_orders.run_sequence int. Scoped meaning:
--      "position of this order in the run queue for (machine_id,
--      production_date)". Null when the order hasn't been placed on
--      a machine for a specific day yet. UI rewrites this column
--      when the operator drags rows on the per-machine screen.
--
--   3. Index on (tenant_id, machine_id, production_date,
--      run_sequence) so the per-machine day-view queries are cheap.
--
--   4. Index on (tenant_id, department, production_date) for the
--      dept day-view sort path (it'll switch to ORDER BY
--      run_sequence asc nulls last, then priority, then code).
--
-- No data migration: existing rows get null machine_id and null
-- run_sequence; they continue to surface in dept queues sorted by
-- priority + code as before.
--
-- ============================================================

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS machine_id   uuid references public.machines(id),
  ADD COLUMN IF NOT EXISTS run_sequence int;

COMMENT ON COLUMN public.production_orders.machine_id IS
  'FK to machines register. Null = unassigned. Legacy text column `machine` is kept for back-compat and mirrored from machines.name on save.';

COMMENT ON COLUMN public.production_orders.run_sequence IS
  'Position in the run queue for (machine_id, production_date). Set by the per-machine drag-to-reorder screen. Lower = runs earlier. Null when not yet placed.';

CREATE INDEX IF NOT EXISTS idx_production_orders_machine_date_seq
  ON public.production_orders (tenant_id, machine_id, production_date, run_sequence)
  WHERE machine_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_production_orders_dept_date
  ON public.production_orders (tenant_id, department, production_date);
