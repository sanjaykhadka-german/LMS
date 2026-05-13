-- ============================================================================
-- 088  FX RATES — locked at quote / order date
-- ----------------------------------------------------------------------------
-- Per-tenant FX rate book. Rates lock onto the PO header at order time so
-- subsequent fx_rates edits never shift historical comparisons. Lookup is
-- "newest rate at-or-before the given date" via get_fx_rate(...).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fx_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  from_currency text NOT NULL,
  to_currency   text NOT NULL,
  rate        numeric NOT NULL CHECK (rate > 0),
  valid_on    date NOT NULL,
  source      text,
  notes       text,
  created_by  uuid REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, from_currency, to_currency, valid_on)
);

COMMENT ON TABLE public.fx_rates IS
  'Per-tenant FX rate book. Lookup via get_fx_rate (newest at-or-before). POs lock rate at order time.';

CREATE INDEX IF NOT EXISTS idx_fx_rates_tenant_lookup
  ON public.fx_rates (tenant_id, from_currency, to_currency, valid_on DESC);

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fx_rates_select" ON public.fx_rates;
CREATE POLICY "fx_rates_select" ON public.fx_rates
  FOR SELECT USING (tenant_id = my_tenant_id());

DROP POLICY IF EXISTS "fx_rates_insert" ON public.fx_rates;
CREATE POLICY "fx_rates_insert" ON public.fx_rates
  FOR INSERT WITH CHECK (tenant_id = my_tenant_id() AND is_manager_or_above());

DROP POLICY IF EXISTS "fx_rates_update" ON public.fx_rates;
CREATE POLICY "fx_rates_update" ON public.fx_rates
  FOR UPDATE USING (tenant_id = my_tenant_id() AND is_manager_or_above());

DROP POLICY IF EXISTS "fx_rates_delete" ON public.fx_rates;
CREATE POLICY "fx_rates_delete" ON public.fx_rates
  FOR DELETE USING (tenant_id = my_tenant_id() AND is_manager_or_above());

DROP TRIGGER IF EXISTS trg_fx_rates_uat ON public.fx_rates;
CREATE TRIGGER trg_fx_rates_uat
  BEFORE UPDATE ON public.fx_rates
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

CREATE OR REPLACE FUNCTION public.get_fx_rate(
  p_tenant_id uuid,
  p_from text,
  p_to   text,
  p_on   date
) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT rate
  FROM public.fx_rates
  WHERE tenant_id = p_tenant_id
    AND from_currency = p_from
    AND to_currency   = p_to
    AND valid_on     <= p_on
  ORDER BY valid_on DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_fx_rate IS
  'Latest tenant FX rate at-or-before p_on for (from→to). Returns NULL when no rate exists.';

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS fx_rate_currency text,
  ADD COLUMN IF NOT EXISTS fx_rate          numeric CHECK (fx_rate IS NULL OR fx_rate > 0),
  ADD COLUMN IF NOT EXISTS fx_rate_locked_at timestamptz;

COMMENT ON COLUMN public.purchase_orders.fx_rate_currency IS
  'Supplier-quote currency. NULL = same as tenant default_currency, no FX needed.';
COMMENT ON COLUMN public.purchase_orders.fx_rate IS
  'Locked rate at order time: 1 unit of fx_rate_currency = fx_rate units of tenant default_currency. Set when the PO is confirmed; never auto-recomputed.';
COMMENT ON COLUMN public.purchase_orders.fx_rate_locked_at IS
  'When the rate was snapshotted onto this PO. Used in audit + reporting.';
