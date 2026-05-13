-- ============================================================================
-- Migration 128 — overheads (Phase 2 rebuild step 3)
--
-- Three tables + two views.
--
-- overhead_actuals       — weekly line entries (category, amount, notes).
--                          One row per (week, category) keeps duplicates out.
-- overhead_week_kg       — manual "kg produced this week" denominator. One
--                          row per (tenant, week_start). Replaceable later
--                          by an auto-roll-up from production_orders.actual.
-- overhead_standard_rate — effective-dated $/kg used in costing display.
--                          previous_rate column snapshots whatever was
--                          effective just before, override_reason captures
--                          the why — gives Tino the audit trail he wants.
--
-- Views:
--   v_overhead_week_summary       — per-week sum + derived $/kg
--   v_overhead_standard_current   — latest effective standard rate per tenant
-- ============================================================================

-- ─── overhead_actuals ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS overhead_actuals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  week_start_date date        NOT NULL,   -- Monday of the week
  category        text        NOT NULL,
  amount          numeric     NOT NULL CHECK (amount >= 0),
  notes           text,
  created_by      uuid        REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, week_start_date, category)
);

CREATE INDEX IF NOT EXISTS idx_overhead_actuals_week
  ON overhead_actuals(tenant_id, week_start_date);

ALTER TABLE overhead_actuals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_select_overhead_actuals" ON overhead_actuals;
DROP POLICY IF EXISTS "tenant_modify_overhead_actuals" ON overhead_actuals;
CREATE POLICY "tenant_select_overhead_actuals" ON overhead_actuals
  FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_modify_overhead_actuals" ON overhead_actuals
  FOR ALL
  USING       (tenant_id = my_tenant_id())
  WITH CHECK  (tenant_id = my_tenant_id());

CREATE OR REPLACE FUNCTION trg_overhead_actuals_touch()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END
$fn$;
DROP TRIGGER IF EXISTS overhead_actuals_touch ON overhead_actuals;
CREATE TRIGGER overhead_actuals_touch
BEFORE UPDATE ON overhead_actuals
FOR EACH ROW EXECUTE FUNCTION trg_overhead_actuals_touch();

COMMENT ON TABLE overhead_actuals IS
  'Per-week, per-category overhead amounts (rent, insurance, freezer power, '
  'depreciation, admin labour, etc). Tenant-wide; not per-dept. Powers '
  'v_overhead_week_summary to compute the real $/kg per week.';

-- ─── overhead_week_kg ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS overhead_week_kg (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  week_start_date date        NOT NULL,
  kg_produced     numeric     NOT NULL CHECK (kg_produced > 0),
  notes           text,
  created_by      uuid        REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, week_start_date)
);

CREATE INDEX IF NOT EXISTS idx_overhead_week_kg_week
  ON overhead_week_kg(tenant_id, week_start_date);

ALTER TABLE overhead_week_kg ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_select_overhead_week_kg" ON overhead_week_kg;
DROP POLICY IF EXISTS "tenant_modify_overhead_week_kg" ON overhead_week_kg;
CREATE POLICY "tenant_select_overhead_week_kg" ON overhead_week_kg
  FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_modify_overhead_week_kg" ON overhead_week_kg
  FOR ALL
  USING       (tenant_id = my_tenant_id())
  WITH CHECK  (tenant_id = my_tenant_id());

CREATE OR REPLACE FUNCTION trg_overhead_week_kg_touch()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END
$fn$;
DROP TRIGGER IF EXISTS overhead_week_kg_touch ON overhead_week_kg;
CREATE TRIGGER overhead_week_kg_touch
BEFORE UPDATE ON overhead_week_kg
FOR EACH ROW EXECUTE FUNCTION trg_overhead_week_kg_touch();

COMMENT ON TABLE overhead_week_kg IS
  'Manually-entered kg produced per week — the denominator for the real '
  '$/kg OH calc. Future: auto-roll up from production_orders.actual_qty '
  'once that capture is reliable.';

-- ─── overhead_standard_rate ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS overhead_standard_rate (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  effective_from  date        NOT NULL DEFAULT CURRENT_DATE,
  rate_per_kg     numeric     NOT NULL CHECK (rate_per_kg >= 0),
  previous_rate   numeric,             -- snapshot of whatever was effective just before
  override_reason text,                -- why is this different from the auto-derived?
  source          text NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual','derived')),
  created_by      uuid        REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_overhead_standard_rate_t_eff
  ON overhead_standard_rate(tenant_id, effective_from DESC);

ALTER TABLE overhead_standard_rate ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_select_overhead_standard_rate" ON overhead_standard_rate;
DROP POLICY IF EXISTS "tenant_modify_overhead_standard_rate" ON overhead_standard_rate;
CREATE POLICY "tenant_select_overhead_standard_rate" ON overhead_standard_rate
  FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_modify_overhead_standard_rate" ON overhead_standard_rate
  FOR ALL
  USING       (tenant_id = my_tenant_id())
  WITH CHECK  (tenant_id = my_tenant_id());

COMMENT ON TABLE overhead_standard_rate IS
  'Effective-dated standard $/kg overhead used in cost cascade display. '
  'previous_rate + override_reason capture WHY each change happened — '
  'audit trail Tino asked for.';


-- ─── v_overhead_week_summary ─────────────────────────────────────────
DROP VIEW IF EXISTS v_overhead_week_summary;
CREATE VIEW v_overhead_week_summary AS
WITH amounts AS (
  SELECT tenant_id, week_start_date,
         SUM(amount) AS total_oh
  FROM overhead_actuals
  GROUP BY tenant_id, week_start_date
)
SELECT
  COALESCE(a.tenant_id, k.tenant_id)             AS tenant_id,
  COALESCE(a.week_start_date, k.week_start_date) AS week_start_date,
  COALESCE(a.total_oh, 0)                        AS total_oh,
  k.kg_produced,
  CASE
    WHEN k.kg_produced IS NULL OR k.kg_produced <= 0 THEN NULL
    ELSE COALESCE(a.total_oh, 0) / k.kg_produced
  END                                            AS derived_dollars_per_kg
FROM amounts a
FULL OUTER JOIN overhead_week_kg k
  ON k.tenant_id = a.tenant_id AND k.week_start_date = a.week_start_date;
GRANT SELECT ON v_overhead_week_summary TO authenticated;

-- ─── v_overhead_standard_current ─────────────────────────────────────
DROP VIEW IF EXISTS v_overhead_standard_current;
CREATE VIEW v_overhead_standard_current AS
SELECT DISTINCT ON (tenant_id)
  id, tenant_id, effective_from, rate_per_kg,
  previous_rate, override_reason, source,
  created_by, created_at
FROM overhead_standard_rate
WHERE effective_from <= CURRENT_DATE
ORDER BY tenant_id, effective_from DESC;
GRANT SELECT ON v_overhead_standard_current TO authenticated;

COMMENT ON VIEW v_overhead_standard_current IS
  'Latest effective standard overhead rate per tenant. Joined by the '
  'cascade (v_item_landed_cost_v3) to add OH $/kg to landed cost.';
