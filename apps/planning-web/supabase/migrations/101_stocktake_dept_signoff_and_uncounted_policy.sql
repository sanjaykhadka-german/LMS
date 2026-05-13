-- ============================================================================
-- 101  Stocktake unification — dept sign-off + uncounted-items policy
-- ----------------------------------------------------------------------------
-- Phase 9.5 v1 (Tino May 2026): the previous flow was 4 type-segregated
-- stocktakes (RM / WIP / FG / Mixed). Operators kept missing items because
-- they fell into the 'wrong' scope. New flow: ONE Mixed stocktake per week,
-- where each department signs off its own counts independently before the
-- whole sheet is committed. Adds:
--
--   • stocktake_department_signoffs — per-(stocktake, department) row
--     stamped when a department lead marks their counts complete
--   • stocktakes.uncounted_policy — controls what happens to items on the
--     stocktake sheet that nobody counted by commit time:
--       'carry_over' (default) — leave the on-hand stock untouched
--       'zero_set'             — write a zero variance against current SOH
--                                 (treat absence as proof of zero stock)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stocktake_department_signoffs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stocktake_id    uuid NOT NULL REFERENCES public.stocktakes(id) ON DELETE CASCADE,
  department_id   uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  signed_off_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  signed_off_at   timestamptz NOT NULL DEFAULT now(),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stocktake_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_stsignoff_stocktake ON public.stocktake_department_signoffs (stocktake_id);
CREATE INDEX IF NOT EXISTS idx_stsignoff_department ON public.stocktake_department_signoffs (department_id);

ALTER TABLE public.stocktake_department_signoffs ENABLE ROW LEVEL SECURITY;

-- Tenant isolation — same pattern as the stocktakes table.
CREATE POLICY stsignoff_tenant_select ON public.stocktake_department_signoffs
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY stsignoff_tenant_insert ON public.stocktake_department_signoffs
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY stsignoff_tenant_update ON public.stocktake_department_signoffs
  FOR UPDATE USING (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY stsignoff_tenant_delete ON public.stocktake_department_signoffs
  FOR DELETE USING (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

COMMENT ON TABLE public.stocktake_department_signoffs IS
  'Phase 9.5 v1: per-department sign-off on a Mixed stocktake. The whole stocktake can only be committed once every department represented on the sheet has a row here (or the operator overrides via the commit modal).';

-- ----------------------------------------------------------------------------
-- Uncounted-items commit policy on the stocktake itself.
-- ----------------------------------------------------------------------------

ALTER TABLE public.stocktakes
  ADD COLUMN IF NOT EXISTS uncounted_policy text NOT NULL DEFAULT 'carry_over';

ALTER TABLE public.stocktakes
  DROP CONSTRAINT IF EXISTS stocktakes_uncounted_policy_check;

ALTER TABLE public.stocktakes
  ADD CONSTRAINT stocktakes_uncounted_policy_check
  CHECK (uncounted_policy IN ('carry_over', 'zero_set'));

COMMENT ON COLUMN public.stocktakes.uncounted_policy IS
  'Phase 9.5 v1: how to treat items on the sheet that nobody counted by commit time. carry_over (default) leaves on-hand stock untouched; zero_set writes a zero variance to drive SOH to zero.';
