-- ============================================================================
-- Migration 127 — production_routings (Phase 2 rebuild step 2)
--
-- Per-BOM list of production steps. Each step is (department, step name,
-- people, minutes, reference qty, reference basis). Joined to the tenant's
-- hourly labour rate (mig 126) to compute step labour cost per kg of the
-- BOM's output. The cascade view (v3, mig TBD) will sum routings up the
-- BOM tree at every node.
--
-- Routings live on bom_header_id (not item_id) so:
--   - new BOM versions can revise the routing without touching the old one
--   - WIPF/WIPP/FG levels each carry their own production steps
--     (e.g. WIPF carries Batching/Mixing/Spices, WIPP carries Filling,
--      FG carries Cutting/Thermoforming/Labelling/Dispatch)
--   - shared WIPFs reuse their routing across every FG that includes them
--
-- reference_basis controls how the step's ref_qty maps to kg of output:
--   'kg'     → ref_qty IS kg
--   'unit'   → ref_qty × target_weight_g / 1000
--   'inner'  → ref_qty × units_per_inner × target_weight_g / 1000
--   'outer'  → ref_qty × units_per_outer × target_weight_g / 1000
--   'pallet' → ref_qty × units_per_pallet × target_weight_g / 1000
-- (The non-kg branches need pack hierarchy on the BOM's owning item; the
-- v_bom_routing_cost view surfaces hierarchy_missing when it can't.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS production_routings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id)      ON DELETE CASCADE,
  bom_header_id   uuid        NOT NULL REFERENCES bom_headers(id)  ON DELETE CASCADE,
  department_id   uuid        NOT NULL REFERENCES departments(id),
  step_name       text        NOT NULL,
  people_count    numeric     NOT NULL CHECK (people_count > 0),
  std_minutes     numeric     NOT NULL CHECK (std_minutes  > 0),
  reference_qty   numeric     NOT NULL CHECK (reference_qty > 0),
  reference_basis text        NOT NULL CHECK (reference_basis IN ('kg','unit','inner','outer','pallet')),
  sort_order      integer     NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_production_routings_bom
  ON production_routings(bom_header_id, sort_order);

ALTER TABLE production_routings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_select_production_routings" ON production_routings;
DROP POLICY IF EXISTS "tenant_modify_production_routings" ON production_routings;

CREATE POLICY "tenant_select_production_routings" ON production_routings
  FOR SELECT USING (tenant_id = my_tenant_id());

CREATE POLICY "tenant_modify_production_routings" ON production_routings
  FOR ALL
  USING       (tenant_id = my_tenant_id())
  WITH CHECK  (tenant_id = my_tenant_id());

-- Tenant + updated_at triggers ------------------------------------------------
CREATE OR REPLACE FUNCTION trg_production_routings_set_tenant()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT bh.tenant_id INTO NEW.tenant_id
    FROM bom_headers bh WHERE bh.id = NEW.bom_header_id;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS production_routings_set_tenant ON production_routings;
CREATE TRIGGER production_routings_set_tenant
BEFORE INSERT ON production_routings
FOR EACH ROW EXECUTE FUNCTION trg_production_routings_set_tenant();

CREATE OR REPLACE FUNCTION trg_production_routings_touch()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END
$fn$;

DROP TRIGGER IF EXISTS production_routings_touch ON production_routings;
CREATE TRIGGER production_routings_touch
BEFORE UPDATE ON production_routings
FOR EACH ROW EXECUTE FUNCTION trg_production_routings_touch();

COMMENT ON TABLE production_routings IS
  'Per-BOM list of production steps (people × minutes per ref_qty of '
  'ref_basis). Joined to v_labour_rate_current to compute step labour '
  '$/kg of BOM output. Summed by the cascade at every BOM node.';


-- ─── v_bom_routing_cost ───────────────────────────────────────────────
-- Per-BOM (per-step) labour cost per kg of BOM output. Two grain levels:
--   v_bom_routing_cost           — per step, with hierarchy_missing flag
--   v_bom_routing_cost_summary   — per BOM, sum of step costs
DROP VIEW IF EXISTS v_bom_routing_cost_summary;
DROP VIEW IF EXISTS v_bom_routing_cost;

CREATE VIEW v_bom_routing_cost AS
SELECT
  pr.id,
  pr.bom_header_id,
  pr.department_id,
  d.name      AS department_name,
  pr.step_name,
  pr.people_count,
  pr.std_minutes,
  pr.reference_qty,
  pr.reference_basis,
  pr.sort_order,
  bh.item_id  AS bom_item_id,
  i.target_weight_g,
  i.units_per_inner,
  i.units_per_outer,
  i.units_per_pallet,
  lrc.hourly_rate,
  -- kg per reference unit, depending on basis
  CASE pr.reference_basis
    WHEN 'kg'     THEN pr.reference_qty
    WHEN 'unit'   THEN
      CASE WHEN i.target_weight_g  > 0 THEN pr.reference_qty * i.target_weight_g / 1000.0 END
    WHEN 'inner'  THEN
      CASE WHEN i.target_weight_g  > 0 AND i.units_per_inner  > 0
           THEN pr.reference_qty * i.units_per_inner  * i.target_weight_g / 1000.0 END
    WHEN 'outer'  THEN
      CASE WHEN i.target_weight_g  > 0 AND i.units_per_outer  > 0
           THEN pr.reference_qty * i.units_per_outer  * i.target_weight_g / 1000.0 END
    WHEN 'pallet' THEN
      CASE WHEN i.target_weight_g  > 0 AND i.units_per_pallet > 0
           THEN pr.reference_qty * i.units_per_pallet * i.target_weight_g / 1000.0 END
  END AS kg_per_reference,
  -- Person-hours per reference, then $ per reference, then $/kg
  (pr.people_count * pr.std_minutes / 60.0) AS person_hours_per_ref,
  (pr.people_count * pr.std_minutes / 60.0) * COALESCE(lrc.hourly_rate, 0) AS dollars_per_ref,
  CASE
    WHEN COALESCE(lrc.hourly_rate, 0) <= 0 THEN NULL
    WHEN pr.reference_basis = 'kg' THEN
      ((pr.people_count * pr.std_minutes / 60.0) * lrc.hourly_rate) / NULLIF(pr.reference_qty, 0)
    WHEN pr.reference_basis = 'unit'   AND i.target_weight_g  > 0 THEN
      ((pr.people_count * pr.std_minutes / 60.0) * lrc.hourly_rate)
        / NULLIF(pr.reference_qty * i.target_weight_g / 1000.0, 0)
    WHEN pr.reference_basis = 'inner'  AND i.target_weight_g  > 0 AND i.units_per_inner  > 0 THEN
      ((pr.people_count * pr.std_minutes / 60.0) * lrc.hourly_rate)
        / NULLIF(pr.reference_qty * i.units_per_inner  * i.target_weight_g / 1000.0, 0)
    WHEN pr.reference_basis = 'outer'  AND i.target_weight_g  > 0 AND i.units_per_outer  > 0 THEN
      ((pr.people_count * pr.std_minutes / 60.0) * lrc.hourly_rate)
        / NULLIF(pr.reference_qty * i.units_per_outer  * i.target_weight_g / 1000.0, 0)
    WHEN pr.reference_basis = 'pallet' AND i.target_weight_g  > 0 AND i.units_per_pallet > 0 THEN
      ((pr.people_count * pr.std_minutes / 60.0) * lrc.hourly_rate)
        / NULLIF(pr.reference_qty * i.units_per_pallet * i.target_weight_g / 1000.0, 0)
    ELSE NULL  -- pack hierarchy missing on the BOM's owning item
  END AS dollars_per_kg,
  CASE
    WHEN pr.reference_basis = 'kg' THEN false
    WHEN pr.reference_basis = 'unit'   AND i.target_weight_g  > 0 THEN false
    WHEN pr.reference_basis = 'inner'  AND i.target_weight_g  > 0 AND i.units_per_inner  > 0 THEN false
    WHEN pr.reference_basis = 'outer'  AND i.target_weight_g  > 0 AND i.units_per_outer  > 0 THEN false
    WHEN pr.reference_basis = 'pallet' AND i.target_weight_g  > 0 AND i.units_per_pallet > 0 THEN false
    ELSE true
  END AS hierarchy_missing
FROM production_routings pr
JOIN bom_headers              bh  ON bh.id  = pr.bom_header_id
JOIN items                    i   ON i.id   = bh.item_id
JOIN departments              d   ON d.id   = pr.department_id
LEFT JOIN v_labour_rate_current lrc ON lrc.tenant_id = pr.tenant_id;

GRANT SELECT ON v_bom_routing_cost TO authenticated;

CREATE VIEW v_bom_routing_cost_summary AS
SELECT
  bom_header_id,
  COUNT(*)                              AS step_count,
  SUM(COALESCE(dollars_per_kg, 0))      AS total_labour_per_kg,
  bool_or(hierarchy_missing)            AS any_hierarchy_missing
FROM v_bom_routing_cost
GROUP BY bom_header_id;

GRANT SELECT ON v_bom_routing_cost_summary TO authenticated;
