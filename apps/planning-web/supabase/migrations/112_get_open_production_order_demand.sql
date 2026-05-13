-- ============================================================================
-- Migration 112 — get_open_production_order_demand
-- Aggregates raw-material / packaging / consumable demand from every
-- production_order with status IN ('planned','in_progress'). Uses the same
-- percentage-driven cascade math as explode_mrp.
-- Powers the /purchasing dashboard's "Need now" view alongside the demand-
-- plan-based number from get_plan_dept_materials.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_open_production_order_demand()
RETURNS TABLE (
  item_id          uuid,
  total_needed     numeric,
  unit             text,
  open_order_count int
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH RECURSIVE explosion AS (
    SELECT po.id           AS source_po_id,
           po.item_id       AS item_id,
           po.planned_qty   AS qty,
           0                AS depth
    FROM   public.production_orders po
    WHERE  po.tenant_id = public.my_tenant_id()
      AND  po.status::text IN ('planned', 'in_progress')
      AND  po.planned_qty > 0
    UNION ALL
    SELECT e.source_po_id, bl.component_item_id,
           CASE
             WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN
               (e.qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0)) * (bl.percentage / 100.0)
             WHEN bl.unit = 'kg' THEN
               (e.qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
                 * (bl.qty_per_batch / NULLIF(line_totals.recipe_sum, 0))
             WHEN bl.basis = 'per_piece'  AND parent.target_weight_g  > 0 THEN
               (e.qty * 1000.0 / parent.target_weight_g) * bl.qty_per_batch
             WHEN bl.basis = 'per_inner'  AND parent.target_weight_g  > 0 AND parent.units_per_inner  > 0 THEN
               (e.qty * 1000.0 / parent.target_weight_g / parent.units_per_inner)  * bl.qty_per_batch
             WHEN bl.basis = 'per_outer'  AND parent.target_weight_g  > 0 AND parent.units_per_outer  > 0 THEN
               (e.qty * 1000.0 / parent.target_weight_g / parent.units_per_outer)  * bl.qty_per_batch
             WHEN bl.basis = 'per_pallet' AND parent.target_weight_g  > 0 AND parent.units_per_pallet > 0 THEN
               (e.qty * 1000.0 / parent.target_weight_g / parent.units_per_pallet) * bl.qty_per_batch
             WHEN bl.basis = 'per_kg' THEN e.qty * bl.qty_per_batch
             ELSE e.qty * bl.qty_per_batch / 1000.0
           END,
           e.depth + 1
    FROM        explosion e
    JOIN        public.items parent ON parent.id = e.item_id
    JOIN        public.bom_headers bh ON bh.item_id = e.item_id AND bh.is_active = true
    JOIN        public.bom_lines   bl ON bl.bom_header_id = bh.id
    LEFT JOIN LATERAL (
      SELECT SUM(bl2.qty_per_batch) AS recipe_sum
      FROM   public.bom_lines bl2
      WHERE  bl2.bom_header_id = bh.id AND bl2.unit = 'kg'
    ) line_totals ON true
    WHERE e.depth < 12 AND e.qty > 0
  ),
  agg AS (
    SELECT e.item_id,
           SUM(e.qty)                    AS total_needed,
           COUNT(DISTINCT e.source_po_id) AS open_order_count
    FROM   explosion e
    JOIN   public.items i ON i.id = e.item_id
    WHERE  i.item_type::text IN ('raw_material', 'packaging', 'consumable')
    GROUP BY e.item_id
  )
  SELECT a.item_id, a.total_needed, i.unit, a.open_order_count::int
  FROM   agg a
  JOIN   public.items i ON i.id = a.item_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_open_production_order_demand() TO authenticated;
