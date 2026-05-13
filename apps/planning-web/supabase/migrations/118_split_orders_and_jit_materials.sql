-- Per-day materials breakdown RPC for JIT planning + purchasing.
-- Same math as get_plan_dept_materials but keyed off production_orders
-- (which carry production_date) so the materials view + purchasing can
-- answer "what do we need by Monday?". Splits of a work order across
-- multiple days are supported automatically — each split is its own row in
-- production_orders with its own production_date, so this RPC sees them.

CREATE OR REPLACE FUNCTION get_plan_materials_by_date(p_demand_plan_id uuid)
RETURNS TABLE(
  production_date    date,
  consuming_dept     text,
  component_id       uuid,
  component_code     text,
  component_name     text,
  component_type     text,
  component_unit     text,
  required_qty       numeric,
  on_hand_qty        numeric,
  net_required_qty   numeric,
  parent_count       int,
  parent_codes       text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH
  parents AS (
    SELECT
      po.id                                                  AS po_id,
      po.production_date,
      po.item_id,
      coalesce(nullif(p.department, ''), p.item_type::text)  AS parent_dept,
      po.planned_qty                                         AS parent_qty,
      bh.id                                                  AS bom_id,
      p.target_weight_g,
      p.units_per_inner,
      p.units_per_outer,
      p.units_per_pallet,
      coalesce(bh.yield_factor, 1.0)                         AS yield_factor,
      p.code                                                 AS parent_code
    FROM public.production_orders po
    JOIN public.items p ON p.id = po.item_id
    LEFT JOIN public.bom_headers bh
           ON bh.item_id = po.item_id AND bh.is_active = true
    WHERE po.demand_plan_id = p_demand_plan_id
      AND po.planned_qty > 0
      AND po.status <> 'cancelled'
      AND bh.id IS NOT NULL
  ),
  recipe_totals AS (
    SELECT bl.bom_header_id AS bom_id, sum(bl.qty_per_batch) AS recipe_sum
    FROM public.bom_lines bl
    WHERE bl.unit = 'kg'
    GROUP BY bl.bom_header_id
  ),
  consumption AS (
    SELECT
      p.production_date,
      p.parent_dept                AS consuming_dept,
      bl.component_item_id         AS component_id,
      p.item_id                    AS parent_item_id,
      p.parent_code                AS parent_code,
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
        WHEN bl.basis = 'per_kg' THEN
          p.parent_qty * bl.qty_per_batch
        ELSE
          p.parent_qty * bl.qty_per_batch / 1000.0
      END AS gross_qty
    FROM parents p
    JOIN public.bom_lines bl ON bl.bom_header_id = p.bom_id
    JOIN public.items     c  ON c.id = bl.component_item_id
    LEFT JOIN recipe_totals rt ON rt.bom_id = p.bom_id
    WHERE c.item_type::text IN ('raw_material', 'packaging', 'consumable')
  )
  SELECT
    cn.production_date,
    cn.consuming_dept,
    cn.component_id,
    i.code                                    AS component_code,
    i.name                                    AS component_name,
    i.item_type::text                         AS component_type,
    i.unit                                    AS component_unit,
    sum(cn.gross_qty)                         AS required_qty,
    coalesce(i.current_stock, 0)              AS on_hand_qty,
    greatest(0, sum(cn.gross_qty) - coalesce(i.current_stock, 0)) AS net_required_qty,
    count(DISTINCT cn.parent_item_id)::int    AS parent_count,
    array_agg(DISTINCT cn.parent_code ORDER BY cn.parent_code) AS parent_codes
  FROM consumption cn
  JOIN public.items i ON i.id = cn.component_id
  WHERE cn.gross_qty > 0
  GROUP BY cn.production_date, cn.consuming_dept, cn.component_id, i.code, i.name, i.item_type, i.unit, i.current_stock;
$$;

GRANT EXECUTE ON FUNCTION get_plan_materials_by_date(uuid) TO authenticated;

COMMENT ON FUNCTION get_plan_materials_by_date(uuid) IS
  'Per-date materials breakdown for JIT planning + purchasing. One row per (production_date, dept, component). Production_date is NULL for unscheduled orders.';
