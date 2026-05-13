-- ============================================================================
-- Migration 124 — dept_cost_rates (Costings Phase 2 schema)
--
-- Per-department per-kg conversion costs, broken into labour / utilities /
-- overhead. New rate = new row with effective_from = today; old rows stay
-- queryable so historical WO costing remains accurate (and Phase 5 variance
-- has the data it needs).
--
-- v_dept_cost_rates_current returns the latest effective rate per dept,
-- which the cascade view (v3, mig 125 next) joins to add conversion cost.
-- ============================================================================

CREATE TABLE IF NOT EXISTS dept_cost_rates (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id         uuid        NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  effective_from        date        NOT NULL DEFAULT CURRENT_DATE,
  labour_rate_per_kg    numeric     NOT NULL DEFAULT 0 CHECK (labour_rate_per_kg    >= 0),
  utilities_rate_per_kg numeric     NOT NULL DEFAULT 0 CHECK (utilities_rate_per_kg >= 0),
  overhead_rate_per_kg  numeric     NOT NULL DEFAULT 0 CHECK (overhead_rate_per_kg  >= 0),
  notes                 text,
  created_by            uuid        REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- One rate per dept per effective date. Editing today's rate replaces the
  -- same row (UPSERT); a new effective_from creates a new row.
  UNIQUE (department_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_dept_cost_rates_dept_eff
  ON dept_cost_rates(department_id, effective_from DESC);

ALTER TABLE dept_cost_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_select_dept_cost_rates" ON dept_cost_rates;
DROP POLICY IF EXISTS "tenant_modify_dept_cost_rates" ON dept_cost_rates;

CREATE POLICY "tenant_select_dept_cost_rates" ON dept_cost_rates
  FOR SELECT USING (tenant_id = my_tenant_id());

CREATE POLICY "tenant_modify_dept_cost_rates" ON dept_cost_rates
  FOR ALL
  USING       (tenant_id = my_tenant_id())
  WITH CHECK  (tenant_id = my_tenant_id());

-- Tenant-id auto-fill on insert (matches the pattern used by mrp_overrides
-- and other rate-style tables — operators don't pass tenant_id explicitly).
CREATE OR REPLACE FUNCTION trg_dept_cost_rates_set_tenant()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM departments WHERE id = NEW.department_id;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS dept_cost_rates_set_tenant ON dept_cost_rates;
CREATE TRIGGER dept_cost_rates_set_tenant
BEFORE INSERT ON dept_cost_rates
FOR EACH ROW EXECUTE FUNCTION trg_dept_cost_rates_set_tenant();

COMMENT ON TABLE dept_cost_rates IS
  'Per-department per-kg conversion costs (labour, utilities, overhead). '
  'Effective-dated — a new effective_from creates a new row; today''s edit '
  'updates the same row via UPSERT on (department_id, effective_from).';


-- ─── Current-rate view ──────────────────────────────────────────────────
DROP VIEW IF EXISTS v_dept_cost_rates_current;

CREATE VIEW v_dept_cost_rates_current AS
SELECT DISTINCT ON (department_id)
  id,
  tenant_id,
  department_id,
  effective_from,
  labour_rate_per_kg,
  utilities_rate_per_kg,
  overhead_rate_per_kg,
  (labour_rate_per_kg + utilities_rate_per_kg + overhead_rate_per_kg)
                                       AS total_rate_per_kg,
  notes,
  created_by,
  created_at
FROM dept_cost_rates
WHERE effective_from <= CURRENT_DATE
ORDER BY department_id, effective_from DESC;

GRANT SELECT ON v_dept_cost_rates_current TO authenticated;

COMMENT ON VIEW v_dept_cost_rates_current IS
  'Latest effective per-dept rate (effective_from <= today). Joined by '
  'the cascade view (v_item_landed_cost_v3, mig 125) to add conversion '
  'cost on top of RM cost.';
