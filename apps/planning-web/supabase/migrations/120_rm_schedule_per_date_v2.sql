-- get_plan_dept_materials_by_day v2 — was multiplying split work orders.
--
-- Old behavior: pulled planned_qty from mrp_results (which is the total
-- across the plan, e.g. 15,000 kg of 9004 Hocks) and joined to
-- production_orders just to get a date column. When an item had multiple
-- splits, the LEFT JOIN created one parent row per date, each with the
-- FULL plan total. So 5 splits of 3,000 kg each looked like 5×15,000.
--
-- New behavior: iterate production_orders directly so each contributes its
-- own planned_qty on its own date. Items with no production_orders fall
-- back to mrp_results (rare — only happens when generateProductionOrders
-- hasn't run yet).

CREATE OR REPLACE FUNCTION get_plan_dept_materials_by_day(p_demand_plan_id uuid)
RETURNS TABLE(
  consuming_dept     text,
  production_date    date,
  component_id       uuid,
  component_code     text,
  component_name     text,
  component_type     text,
  component_unit     text,
  required_qty       numeric,
  on_hand_qty        numeric,
  min_stock          numeric,
  max_stock          numeric,
  standard_cost      numeric,
  net_required_qty   numeric,
  parent_count       int,
  parent_codes       text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH
  po_parents AS (
    SELECT po.item_id, po.production_date, po.planned_qty
    FROM public.production_orders po
    WHERE po.demand_plan_id = p_demand_plan_id
      AND po.status <> 'cancelled'
      AND po.planned_qty > 0
  ),
  items_with_orders AS (
    SELECT DISTINCT item_id FROM po_parents
  ),
  fallback_parents AS (
    SELECT m.item_id, m.scheduled_date AS production_date, m.planned_qty
    FROM public.mrp_results m
    WHERE m.demand_plan_id = p_demand_plan_id
      AND m.planned_qty > 0
      AND NOT EXISTS (SELECT 1 FROM items_with_orders iwo WHERE iwo.item_id = m.item_id)
  ),
  all_parents AS (
    SELECT * FROM po_parents
    UNION ALL
    SELECT * FROM fallback_parents
  ),
  parents AS (
    SELECT
      ap.item_id,
      coalesce(nullif(p.department, ''), p.item_type::text) AS parent_dept,
      ap.production_date,
      ap.planned_qty                                        AS parent_qty,
      bh.id                                                 AS bom_id,
      p.target_weight_g,
      p.units_per_inner,
      p.units_per_outer,
      p.units_per_pallet,
      coalesce(bh.yield_factor, 1.0)                        AS yield_factor,
      p.code                                                AS parent_code
    FROM all_parents ap
    JOIN public.items p ON p.id = ap.item_id
    LEFT JOIN public.bom_headers bh
           ON bh.item_id = ap.item_id AND bh.is_active = true
    WHERE bh.id IS NOT NULL
  ),
  recipe_totals AS (
    SELECT bl.bom_header_id AS bom_id, sum(bl.qty_per_batch) AS recipe_sum
    FROM public.bom_lines bl
    WHERE bl.unit = 'kg'
    GROUP BY bl.bom_header_id
  ),
  consumption AS (
    SELECT
      p.parent_dept                AS consuming_dept,
      p.production_date,
      bl.component_item_id         AS component_id,
      p.item_id                    AS parent_item_id,
      p.parent_code,
      CASE
        WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN
          (p.parent_qty / nullif(p.yield_factor, 0)) * (bl.percentage / 100.0)
        WHEN bl.unit = 'kg' THEN
          (p.parent_qty / nullif(p.yield_factor, 0))
            * (bl.qty_per_batch / nullif(rt.recipe_sum, 0))
        WHEN bl.basis = 'per_piece'  AND p.target_weight_g  > 0 THEN
          (p.parent_qty * 1000.0 / p.target_weight_g) * bl.qty_per_batch
        WHEN bl.basis = 'per_inner'  AND p.target_weight_g  > 0 AND p.units_per_inner  > 0 THEN
          (p.parent_qty * 1000.0 / p.target_weight_g / p.units_per_inner)  * bl.qty_per_batch
        WHEN bl.basis = 'per_outer'  AND p.target_weight_g  > 0 AND p.units_per_outer  > 0 THEN
          (p.parent_qty * 1000.0 / p.target_weight_g / p.units_per_outer)  * bl.qty_per_batch
        WHEN bl.basis = 'per_pallet' AND p.target_weight_g  > 0 AND p.units_per_pallet > 0 THEN
          (p.parent_qty * 1000.0 / p.target_weight_g / p.units_per_pallet) * bl.qty_per_batch
        WHEN bl.basis = 'per_kg' THEN p.parent_qty * bl.qty_per_batch
        ELSE p.parent_qty * bl.qty_per_batch / 1000.0
      END AS gross_qty
    FROM parents p
    JOIN public.bom_lines bl ON bl.bom_header_id = p.bom_id
    JOIN public.items     c  ON c.id = bl.component_item_id
    LEFT JOIN recipe_totals rt ON rt.bom_id = p.bom_id
    WHERE c.item_type::text IN ('raw_material', 'packaging', 'consumable')
  ),
  cost_per_item AS (
    SELECT item_id, coalesce(standard_cost, supplier_min_price, 0) AS effective_cost
    FROM public.v_item_cost_health
  )
  SELECT
    cn.consuming_dept,
    cn.production_date,
    cn.component_id,
    i.code                                  AS component_code,
    i.name                                  AS component_name,
    i.item_type::text                       AS component_type,
    i.unit                                  AS component_unit,
    sum(cn.gross_qty)                       AS required_qty,
    coalesce(i.current_stock, 0)            AS on_hand_qty,
    coalesce(i.min_stock, 0)                AS min_stock,
    coalesce(i.max_stock, 0)                AS max_stock,
    coalesce(cp.effective_cost, 0)          AS standard_cost,
    greatest(0, sum(cn.gross_qty) - coalesce(i.current_stock, 0)) AS net_required_qty,
    count(DISTINCT cn.parent_item_id)::int  AS parent_count,
    array_agg(DISTINCT cn.parent_code ORDER BY cn.parent_code) AS parent_codes
  FROM consumption cn
  JOIN public.items i ON i.id = cn.component_id
  LEFT JOIN cost_per_item cp ON cp.item_id = cn.component_id
  WHERE cn.gross_qty > 0
  GROUP BY cn.consuming_dept, cn.production_date, cn.component_id,
           i.code, i.name, i.item_type, i.unit, i.current_stock,
           i.min_stock, i.max_stock, cp.effective_cost;
$$;

COMMENT ON FUNCTION get_plan_dept_materials_by_day(uuid) IS
  'v2 (2026-05-10): iterates production_orders directly so split work orders contribute correctly per-date. Falls back to mrp_results for items without orders.';
