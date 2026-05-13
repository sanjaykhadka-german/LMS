-- ============================================================================
-- 106  Purchase orders — approval gate + plan provenance
-- ----------------------------------------------------------------------------
-- Phase 9.5 (Tino May 2026):
--   • source_plan_id: which demand plan a PO was built against (drives the
--     "ordered vs needed" KPI on the suggestions page).
--   • approval_status / approved_at / approved_by: 2-step gate before a draft
--     PO can be emailed to the supplier. Manager+ approves; operator builds
--     drafts but can't send.
-- ============================================================================
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS source_plan_id   uuid REFERENCES public.demand_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_status  text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_approval_status_check;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_approval_status_check
  CHECK (approval_status IN ('pending', 'approved'));

CREATE INDEX IF NOT EXISTS idx_purchase_orders_source_plan
  ON public.purchase_orders(source_plan_id) WHERE source_plan_id IS NOT NULL;

COMMENT ON COLUMN public.purchase_orders.source_plan_id IS
  'Phase 9.5: demand plan this PO was built against. Drives the suggestions-page KPI strip showing ordered vs needed value per plan.';
COMMENT ON COLUMN public.purchase_orders.approval_status IS
  'Phase 9.5: pending | approved. PO must be approved before it can be emailed to the supplier.';
