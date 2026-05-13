-- ============================================================================
-- Migration 132 — pricing_buffers (Phase 2.5: minimum sell price)
--
-- Tenant-wide buffer percentages applied on top of COGS to arrive at the
-- "minimum sell price" — the floor below which Tino refuses to sell.
--
-- Components:
--   production_loss_pct  — give-away (overfill / cook loss not in BOM yield)
--   depreciation_pct     — share of equipment depreciation not in dept OH
--   sample_pct           — free samples / quality holds / dev runs
--   product_dev_pct      — R&D loading
--   error_pct            — operational buffer (weighing errors, recipe drift)
--   target_margin_pct    — gross profit margin target (revenue-based:
--                          price = loaded_cost / (1 - margin_pct/100))
--
-- All percentages are on the COGS base; they sum into a "loaded cost"
-- before margin is applied (margin uses the loaded cost as its base).
-- Effective-dated rows so changes are auditable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS pricing_buffers (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  effective_from      date        NOT NULL DEFAULT CURRENT_DATE,
  production_loss_pct numeric     NOT NULL DEFAULT 0 CHECK (production_loss_pct >= 0 AND production_loss_pct < 100),
  depreciation_pct    numeric     NOT NULL DEFAULT 0 CHECK (depreciation_pct    >= 0 AND depreciation_pct    < 100),
  sample_pct          numeric     NOT NULL DEFAULT 0 CHECK (sample_pct          >= 0 AND sample_pct          < 100),
  product_dev_pct     numeric     NOT NULL DEFAULT 0 CHECK (product_dev_pct     >= 0 AND product_dev_pct     < 100),
  error_pct           numeric     NOT NULL DEFAULT 0 CHECK (error_pct           >= 0 AND error_pct           < 100),
  target_margin_pct   numeric     NOT NULL DEFAULT 0 CHECK (target_margin_pct   >= 0 AND target_margin_pct   < 100),
  notes               text,
  created_by          uuid        REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_pricing_buffers_t_eff
  ON pricing_buffers(tenant_id, effective_from DESC);

ALTER TABLE pricing_buffers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_select_pricing_buffers" ON pricing_buffers;
DROP POLICY IF EXISTS "tenant_modify_pricing_buffers" ON pricing_buffers;
CREATE POLICY "tenant_select_pricing_buffers" ON pricing_buffers
  FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_modify_pricing_buffers" ON pricing_buffers
  FOR ALL USING (tenant_id = my_tenant_id()) WITH CHECK (tenant_id = my_tenant_id());

COMMENT ON TABLE pricing_buffers IS
  'Tenant-wide buffer percentages used to compute the minimum sell price '
  'from COGS. Effective-dated; future per-item overrides may layer on top.';

DROP VIEW IF EXISTS v_pricing_buffers_current;
CREATE VIEW v_pricing_buffers_current AS
SELECT DISTINCT ON (tenant_id)
  id, tenant_id, effective_from,
  production_loss_pct, depreciation_pct, sample_pct,
  product_dev_pct, error_pct, target_margin_pct,
  notes, created_by, created_at
FROM pricing_buffers
WHERE effective_from <= CURRENT_DATE
ORDER BY tenant_id, effective_from DESC;
GRANT SELECT ON v_pricing_buffers_current TO authenticated;

COMMENT ON VIEW v_pricing_buffers_current IS
  'Latest effective pricing buffers per tenant. Joined by the breakdown '
  'page to compute minimum sell price.';
