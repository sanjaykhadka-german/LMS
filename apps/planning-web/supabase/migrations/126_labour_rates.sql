-- ============================================================================
-- Migration 126 — labour_rates (Phase 2 rebuild step 1)
--
-- Tenant-level standard hourly labour rate. Effective-dated rows so today's
-- save UPSERTs and tomorrow's save creates a fresh row; history is preserved
-- so historical WO costing remains accurate.
--
-- Future: add nullable department_id for per-dept overrides (e.g. cleaning
-- labour costs less than skilled filling-line labour). Today: one number
-- per tenant. Used by the routing math: step_$_per_kg = (people × min/60)
-- × hourly_rate ÷ ref_qty.
-- ============================================================================

CREATE TABLE IF NOT EXISTS labour_rates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  effective_from  date        NOT NULL DEFAULT CURRENT_DATE,
  hourly_rate     numeric     NOT NULL CHECK (hourly_rate >= 0),
  notes           text,
  created_by      uuid        REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- One rate per tenant per date. Editing today UPSERTs the same row.
  UNIQUE (tenant_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_labour_rates_tenant_eff
  ON labour_rates(tenant_id, effective_from DESC);

ALTER TABLE labour_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_select_labour_rates" ON labour_rates;
DROP POLICY IF EXISTS "tenant_modify_labour_rates" ON labour_rates;

CREATE POLICY "tenant_select_labour_rates" ON labour_rates
  FOR SELECT USING (tenant_id = my_tenant_id());

CREATE POLICY "tenant_modify_labour_rates" ON labour_rates
  FOR ALL
  USING       (tenant_id = my_tenant_id())
  WITH CHECK  (tenant_id = my_tenant_id());

COMMENT ON TABLE labour_rates IS
  'Tenant-level standard hourly labour rate. Effective-dated; new save = '
  'new effective_from row, today edit = UPSERT same row. Used by routing '
  'math to convert (people × minutes) into $.';


-- ─── Current-rate view ──────────────────────────────────────────────────
DROP VIEW IF EXISTS v_labour_rate_current;

CREATE VIEW v_labour_rate_current AS
SELECT DISTINCT ON (tenant_id)
  id,
  tenant_id,
  effective_from,
  hourly_rate,
  notes,
  created_by,
  created_at
FROM labour_rates
WHERE effective_from <= CURRENT_DATE
ORDER BY tenant_id, effective_from DESC;

GRANT SELECT ON v_labour_rate_current TO authenticated;

COMMENT ON VIEW v_labour_rate_current IS
  'Latest effective hourly labour rate per tenant. Joined by routing '
  'cost math (mig TBD) to compute labour cost per kg of product.';
