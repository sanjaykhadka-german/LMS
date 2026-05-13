-- Manual MRP overrides — emergency release valve when a typo or BOM bug
-- inflates a department's quantity. Operator can override the qty on a
-- (plan, item, dept) row; the cascade re-flows downstream raw materials
-- using the override as the new basis for THAT node only. Other depts of
-- the same item are unaffected.
--
-- Plus an updated explode_mrp v2 that applies these overrides after the
-- normal cascade by rescaling the overridden node's contribution to its
-- descendants (subtracting the cascade-derived share and adding a share
-- proportional to the override).

-- ─── Table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mrp_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  demand_plan_id  uuid NOT NULL REFERENCES demand_plans(id) ON DELETE CASCADE,
  item_id         uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  department      text NOT NULL,
  override_qty    numeric NOT NULL CHECK (override_qty >= 0),
  reason          text,
  overridden_by   uuid REFERENCES auth.users(id),
  overridden_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES auth.users(id),
  resolved_note   text,
  UNIQUE (demand_plan_id, item_id, department)
);

CREATE INDEX IF NOT EXISTS idx_mrp_overrides_plan       ON mrp_overrides(demand_plan_id);
CREATE INDEX IF NOT EXISTS idx_mrp_overrides_unresolved ON mrp_overrides(demand_plan_id) WHERE resolved_at IS NULL;

ALTER TABLE mrp_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_select_overrides" ON mrp_overrides;
DROP POLICY IF EXISTS "tenant_modify_overrides" ON mrp_overrides;
CREATE POLICY "tenant_select_overrides" ON mrp_overrides FOR SELECT
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_modify_overrides" ON mrp_overrides FOR ALL
  USING (tenant_id = my_tenant_id())
  WITH CHECK (tenant_id = my_tenant_id());

CREATE OR REPLACE FUNCTION trg_mrp_overrides_set_tenant()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM demand_plans WHERE id = NEW.demand_plan_id;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS mrp_overrides_set_tenant ON mrp_overrides;
CREATE TRIGGER mrp_overrides_set_tenant
BEFORE INSERT ON mrp_overrides
FOR EACH ROW EXECUTE FUNCTION trg_mrp_overrides_set_tenant();

COMMENT ON TABLE mrp_overrides IS
  'Per (demand_plan, item, department) emergency override of the MRP-computed qty. '
  'Lets a planner ship despite a BOM data bug while an admin amends the source data. '
  'Cascades downstream to raw materials but does not affect the same item in other depts.';

-- ─── explode_mrp v2 ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION explode_mrp(p_demand_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_tenant_id uuid;
  v_override  RECORD;
  v_old_qty   numeric;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.demand_plans WHERE id = p_demand_plan_id;
  DELETE FROM public.mrp_results WHERE demand_plan_id = p_demand_plan_id;

  -- 1) Normal cascade
  INSERT INTO public.mrp_results (
    demand_plan_id, item_id, department, bom_id,
    required_qty, on_hand_qty, net_required_qty, unit,
    standard_batch_size, suggested_batches, rounded_batches,
    planned_qty, surplus_qty
  )
  WITH RECURSIVE bom_explosion AS (
    SELECT
      dl.item_id,
      GREATEST(0, COALESCE(dl.planned_qty_kg, dl.planned_weight_kg, 0) - COALESCE(i.current_stock, 0))::numeric AS required_qty,
      0 AS depth
    FROM public.demand_lines dl
    JOIN public.items i ON i.id = dl.item_id
    WHERE dl.demand_plan_id = p_demand_plan_id

    UNION ALL

    SELECT successor.item_id, successor.qty, be.depth + 1
    FROM bom_explosion be
    JOIN public.items parent ON parent.id = be.item_id
    JOIN LATERAL (
      SELECT
        parent.parent_item_id AS item_id,
        be.required_qty       AS qty
      WHERE parent.parent_item_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.bom_headers bh_chk
          JOIN public.bom_lines bl_chk ON bl_chk.bom_header_id = bh_chk.id
          WHERE bh_chk.item_id = be.item_id
            AND bh_chk.is_active = true
            AND bl_chk.component_item_id = parent.parent_item_id
        )
      UNION ALL
      SELECT
        bl.component_item_id,
        CASE
          WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN
            (be.required_qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0)) * (bl.percentage / 100.0)
          WHEN bl.unit = 'kg' THEN
            (be.required_qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0)) * (bl.qty_per_batch / NULLIF(line_totals.recipe_sum, 0))
          WHEN bl.basis = 'per_piece' AND parent.target_weight_g > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g) * bl.qty_per_batch
          WHEN bl.basis = 'per_inner' AND parent.target_weight_g > 0 AND parent.units_per_inner > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_inner) * bl.qty_per_batch
          WHEN bl.basis = 'per_outer' AND parent.target_weight_g > 0 AND parent.units_per_outer > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_outer) * bl.qty_per_batch
          WHEN bl.basis = 'per_pallet' AND parent.target_weight_g > 0 AND parent.units_per_pallet > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_pallet) * bl.qty_per_batch
          WHEN bl.basis = 'per_kg' THEN
            be.required_qty * bl.qty_per_batch
          ELSE
            be.required_qty * bl.qty_per_batch / 1000.0
        END AS qty
      FROM public.bom_headers bh
      JOIN public.bom_lines bl ON bl.bom_header_id = bh.id
      LEFT JOIN LATERAL (
        SELECT SUM(bl2.qty_per_batch) AS recipe_sum
        FROM public.bom_lines bl2
        WHERE bl2.bom_header_id = bh.id AND bl2.unit = 'kg'
      ) line_totals ON true
      WHERE bh.item_id = be.item_id AND bh.is_active = true
    ) successor ON successor.item_id IS NOT NULL
    WHERE be.depth < 12 AND be.required_qty > 0 AND successor.qty > 0
  ),
  agg AS (
    SELECT be.item_id, sum(be.required_qty) AS gross
    FROM bom_explosion be
    GROUP BY be.item_id
  )
  SELECT
    p_demand_plan_id,
    a.item_id,
    COALESCE(NULLIF(i.department, ''), i.item_type::text) AS department,
    (SELECT id FROM public.bom_headers WHERE item_id = a.item_id AND is_active = true LIMIT 1) AS bom_id,
    a.gross,
    COALESCE(i.current_stock, 0),
    GREATEST(0, a.gross - COALESCE(i.current_stock, 0)),
    i.unit,
    i.default_batch_size,
    NULL::numeric, NULL::int,
    GREATEST(0, a.gross - COALESCE(i.current_stock, 0)),
    0::numeric
  FROM agg a
  JOIN public.items i ON i.id = a.item_id;

  -- 2) Apply each unresolved override
  FOR v_override IN
    SELECT mo.id, mo.item_id, mo.department, mo.override_qty
    FROM public.mrp_overrides mo
    WHERE mo.demand_plan_id = p_demand_plan_id
      AND mo.resolved_at IS NULL
  LOOP
    SELECT mr.required_qty
      INTO v_old_qty
      FROM public.mrp_results mr
     WHERE mr.demand_plan_id = p_demand_plan_id
       AND mr.item_id        = v_override.item_id
       AND mr.department     = v_override.department
     LIMIT 1;

    IF v_old_qty IS NULL THEN v_old_qty := 0; END IF;

    -- Per-unit-of-Y factor for each descendant
    WITH RECURSIVE sub AS (
      SELECT v_override.item_id AS item_id, 1.0::numeric AS qty, 0 AS depth
      UNION ALL
      SELECT successor.item_id, successor.qty, sub.depth + 1
      FROM sub
      JOIN public.items parent ON parent.id = sub.item_id
      JOIN LATERAL (
        SELECT
          bl.component_item_id AS item_id,
          CASE
            WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN
              (sub.qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0)) * (bl.percentage / 100.0)
            WHEN bl.unit = 'kg' THEN
              (sub.qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0)) * (bl.qty_per_batch / NULLIF(line_totals.recipe_sum, 0))
            WHEN bl.basis = 'per_piece' AND parent.target_weight_g > 0 THEN
              (sub.qty * 1000.0 / parent.target_weight_g) * bl.qty_per_batch
            WHEN bl.basis = 'per_inner' AND parent.target_weight_g > 0 AND parent.units_per_inner > 0 THEN
              (sub.qty * 1000.0 / parent.target_weight_g / parent.units_per_inner) * bl.qty_per_batch
            WHEN bl.basis = 'per_outer' AND parent.target_weight_g > 0 AND parent.units_per_outer > 0 THEN
              (sub.qty * 1000.0 / parent.target_weight_g / parent.units_per_outer) * bl.qty_per_batch
            WHEN bl.basis = 'per_pallet' AND parent.target_weight_g > 0 AND parent.units_per_pallet > 0 THEN
              (sub.qty * 1000.0 / parent.target_weight_g / parent.units_per_pallet) * bl.qty_per_batch
            WHEN bl.basis = 'per_kg' THEN
              sub.qty * bl.qty_per_batch
            ELSE
              sub.qty * bl.qty_per_batch / 1000.0
          END AS qty
        FROM public.bom_headers bh
        JOIN public.bom_lines bl ON bl.bom_header_id = bh.id
        LEFT JOIN LATERAL (
          SELECT SUM(bl2.qty_per_batch) AS recipe_sum
          FROM public.bom_lines bl2
          WHERE bl2.bom_header_id = bh.id AND bl2.unit = 'kg'
        ) line_totals ON true
        WHERE bh.item_id = sub.item_id AND bh.is_active = true
      ) successor ON successor.item_id IS NOT NULL
      WHERE sub.depth < 12 AND sub.qty > 0 AND successor.qty > 0
    ),
    factors AS (
      SELECT item_id, sum(qty) AS factor
      FROM sub
      WHERE item_id <> v_override.item_id
      GROUP BY item_id
    )
    UPDATE public.mrp_results mr
       SET required_qty     = GREATEST(0, mr.required_qty + f.factor * (v_override.override_qty - v_old_qty)),
           net_required_qty = GREATEST(0,
                                mr.required_qty + f.factor * (v_override.override_qty - v_old_qty)
                                - COALESCE(mr.on_hand_qty, 0)),
           planned_qty      = GREATEST(0,
                                mr.required_qty + f.factor * (v_override.override_qty - v_old_qty)
                                - COALESCE(mr.on_hand_qty, 0))
      FROM factors f
     WHERE mr.demand_plan_id = p_demand_plan_id
       AND mr.item_id        = f.item_id;

    -- Replace Y's row qty with the override
    UPDATE public.mrp_results mr
       SET required_qty     = v_override.override_qty,
           net_required_qty = GREATEST(0, v_override.override_qty - COALESCE(mr.on_hand_qty, 0)),
           planned_qty      = GREATEST(0, v_override.override_qty - COALESCE(mr.on_hand_qty, 0))
     WHERE mr.demand_plan_id = p_demand_plan_id
       AND mr.item_id        = v_override.item_id
       AND mr.department     = v_override.department;
  END LOOP;
END;
$fn$;

COMMENT ON FUNCTION explode_mrp(uuid) IS
  'v2 (2026-05-10): supports per-(item,dept,plan) manual overrides via mrp_overrides table. '
  'Override is applied post-cascade by rescaling the overridden node`s contribution to descendants.';
