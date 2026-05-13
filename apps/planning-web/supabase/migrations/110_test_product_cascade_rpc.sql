-- ============================================================================
-- Migration 110 — test_product_cascade RPC (Phase 2)
--
-- Powers the "▷ Test this product" button on the item detail page. Takes a
-- hypothetical order (qty + UOM) and runs it through the BOM cascade
-- without persisting anything. Returns cascade stages, shopping list with
-- costs, and totals as JSONB.
--
-- Reuses the same percentage-driven cascade math as explode_mrp.
-- Idempotent: CREATE OR REPLACE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.test_product_cascade(
  p_item_id  uuid,
  p_quantity numeric,
  p_uom      text DEFAULT 'units'  -- 'units' | 'kg' | 'inner' | 'outer' | 'pallet'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_item        RECORD;
  v_target_g    numeric;
  v_upi         numeric;
  v_ipo         numeric;
  v_opp         numeric;
  v_total_kg    numeric;
  v_total_units numeric;
  v_cascade     jsonb;
  v_shopping    jsonb;
  v_total_cost  numeric;
BEGIN
  SELECT i.id, i.code, i.name, i.unit, i.item_type, i.target_weight_g,
         i.units_per_inner, i.inner_per_outer, i.outers_per_pallet,
         i.tenant_id
  INTO   v_item
  FROM   public.items i
  WHERE  i.id = p_item_id
    AND  i.tenant_id = my_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found in your tenant'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_target_g := COALESCE(v_item.target_weight_g, 0);
  v_upi      := GREATEST(COALESCE(v_item.units_per_inner,   1), 1);
  v_ipo      := GREATEST(COALESCE(v_item.inner_per_outer,   1), 1);
  v_opp      := GREATEST(COALESCE(v_item.outers_per_pallet, 1), 1);

  IF p_uom NOT IN ('units','kg','inner','outer','pallet') THEN
    RAISE EXCEPTION 'invalid uom %, must be one of: units, kg, inner, outer, pallet', p_uom
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_uom <> 'kg' AND v_target_g <= 0 THEN
    RAISE EXCEPTION 'item % has no target_weight_g; only kg UOM is supported for this product', v_item.code
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'quantity must be a non-negative number'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_total_kg := CASE p_uom
    WHEN 'units'  THEN p_quantity * v_target_g / 1000.0
    WHEN 'kg'     THEN p_quantity
    WHEN 'inner'  THEN p_quantity * v_upi * v_target_g / 1000.0
    WHEN 'outer'  THEN p_quantity * v_upi * v_ipo * v_target_g / 1000.0
    WHEN 'pallet' THEN p_quantity * v_upi * v_ipo * v_opp * v_target_g / 1000.0
  END;
  v_total_units := CASE WHEN v_target_g > 0 THEN v_total_kg * 1000.0 / v_target_g ELSE NULL END;

  -- Cascade rows (intermediate items: items with their own BOM)
  WITH RECURSIVE explosion AS (
    SELECT v_item.id AS item_id, v_total_kg AS qty, 0 AS depth,
           v_item.code AS code, v_item.name AS name, v_item.item_type AS item_type, v_item.unit AS uom,
           ARRAY[v_item.code]::text[] AS path
    UNION ALL
    SELECT bl.component_item_id,
      CASE
        WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN
          (e.qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0)) * (bl.percentage / 100.0)
        WHEN bl.unit = 'kg' THEN
          (e.qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
            * (bl.qty_per_batch / NULLIF(line_totals.recipe_sum, 0))
        WHEN bl.basis = 'per_piece' AND parent.target_weight_g > 0 THEN
          (e.qty * 1000.0 / parent.target_weight_g) * bl.qty_per_batch
        WHEN bl.basis = 'per_inner' AND parent.target_weight_g > 0 AND parent.units_per_inner > 0 THEN
          (e.qty * 1000.0 / parent.target_weight_g / parent.units_per_inner) * bl.qty_per_batch
        WHEN bl.basis = 'per_outer' AND parent.target_weight_g > 0 AND parent.units_per_outer > 0 THEN
          (e.qty * 1000.0 / parent.target_weight_g / parent.units_per_outer) * bl.qty_per_batch
        WHEN bl.basis = 'per_pallet' AND parent.target_weight_g > 0 AND parent.units_per_pallet > 0 THEN
          (e.qty * 1000.0 / parent.target_weight_g / parent.units_per_pallet) * bl.qty_per_batch
        WHEN bl.basis = 'per_kg' THEN e.qty * bl.qty_per_batch
        ELSE e.qty * bl.qty_per_batch / 1000.0
      END,
      e.depth + 1, ic.code, ic.name, ic.item_type, bl.unit, e.path || ic.code
    FROM        explosion e
    JOIN        public.items parent ON parent.id = e.item_id
    JOIN        public.bom_headers bh ON bh.item_id = e.item_id AND bh.is_active = true
    JOIN        public.bom_lines   bl ON bl.bom_header_id = bh.id
    JOIN        public.items       ic ON ic.id = bl.component_item_id
    LEFT JOIN LATERAL (
      SELECT SUM(bl2.qty_per_batch) AS recipe_sum
      FROM   public.bom_lines bl2
      WHERE  bl2.bom_header_id = bh.id
        AND  bl2.unit = 'kg'
    ) line_totals ON true
    WHERE e.depth < 12 AND e.qty > 0 AND ic.code <> ALL(e.path)
  ),
  agg AS (
    SELECT item_id, MAX(code) AS code, MAX(name) AS name, MAX(item_type) AS item_type,
           MAX(uom) AS uom, MAX(depth) AS depth, SUM(qty) AS gross_qty
    FROM   explosion GROUP BY item_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'stage_name', a.code, 'stage_label', a.name,
    'department', COALESCE(NULLIF(i.department, ''), i.item_type::text),
    'item_type', a.item_type, 'depth', a.depth,
    'required_qty', round(a.gross_qty, 4), 'unit', a.uom
  ) ORDER BY a.depth, a.code)
  INTO v_cascade
  FROM agg a
  JOIN public.items i ON i.id = a.item_id
  WHERE a.item_type IN ('finished_good','wip','wipf','wipp');

  -- Shopping list (leaf components: raw_material, packaging, consumable)
  WITH RECURSIVE explosion AS (
    SELECT v_item.id AS item_id, v_total_kg AS qty, 0 AS depth,
           v_item.code AS code, v_item.name AS name, v_item.item_type AS item_type, v_item.unit AS uom,
           ARRAY[v_item.code]::text[] AS path
    UNION ALL
    SELECT bl.component_item_id,
      CASE
        WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN
          (e.qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0)) * (bl.percentage / 100.0)
        WHEN bl.unit = 'kg' THEN
          (e.qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
            * (bl.qty_per_batch / NULLIF(lt.recipe_sum, 0))
        WHEN bl.basis = 'per_piece' AND parent.target_weight_g > 0 THEN
          (e.qty * 1000.0 / parent.target_weight_g) * bl.qty_per_batch
        WHEN bl.basis = 'per_inner' AND parent.target_weight_g > 0 AND parent.units_per_inner > 0 THEN
          (e.qty * 1000.0 / parent.target_weight_g / parent.units_per_inner) * bl.qty_per_batch
        WHEN bl.basis = 'per_outer' AND parent.target_weight_g > 0 AND parent.units_per_outer > 0 THEN
          (e.qty * 1000.0 / parent.target_weight_g / parent.units_per_outer) * bl.qty_per_batch
        WHEN bl.basis = 'per_pallet' AND parent.target_weight_g > 0 AND parent.units_per_pallet > 0 THEN
          (e.qty * 1000.0 / parent.target_weight_g / parent.units_per_pallet) * bl.qty_per_batch
        WHEN bl.basis = 'per_kg' THEN e.qty * bl.qty_per_batch
        ELSE e.qty * bl.qty_per_batch / 1000.0
      END,
      e.depth + 1, ic.code, ic.name, ic.item_type, bl.unit, e.path || ic.code
    FROM explosion e
    JOIN public.items parent ON parent.id = e.item_id
    JOIN public.bom_headers bh ON bh.item_id = e.item_id AND bh.is_active = true
    JOIN public.bom_lines   bl ON bl.bom_header_id = bh.id
    JOIN public.items       ic ON ic.id = bl.component_item_id
    LEFT JOIN LATERAL (
      SELECT SUM(bl2.qty_per_batch) AS recipe_sum
      FROM   public.bom_lines bl2
      WHERE  bl2.bom_header_id = bh.id AND bl2.unit = 'kg'
    ) lt ON true
    WHERE e.depth < 12 AND e.qty > 0 AND ic.code <> ALL(e.path)
  ),
  agg AS (
    SELECT item_id, MAX(code) AS code, MAX(name) AS name, MAX(item_type) AS item_type,
           MAX(uom) AS uom, SUM(qty) AS gross_qty
    FROM explosion GROUP BY item_id
  )
  SELECT
    jsonb_agg(jsonb_build_object(
      'item_id', a.item_id, 'code', a.code, 'name', a.name,
      'qty', round(a.gross_qty, 4), 'unit', a.uom,
      'unit_cost', round(COALESCE(ich.standard_cost, ich.supplier_min_price, 0), 4),
      'line_cost', round(a.gross_qty * COALESCE(ich.standard_cost, ich.supplier_min_price, 0), 2),
      'supplier_id', ich.cheapest_supplier_id,
      'supplier_name', s.name,
      'lead_time_days', si.lead_time_days
    ) ORDER BY a.code),
    SUM(a.gross_qty * COALESCE(ich.standard_cost, ich.supplier_min_price, 0))
  INTO v_shopping, v_total_cost
  FROM agg a
  LEFT JOIN public.v_item_cost_health ich ON ich.item_id = a.item_id
  LEFT JOIN public.suppliers          s   ON s.id        = ich.cheapest_supplier_id
  LEFT JOIN public.supplier_items     si  ON si.item_id  = a.item_id AND si.supplier_id = ich.cheapest_supplier_id
  WHERE a.item_type IN ('raw_material','packaging','consumable');

  RETURN jsonb_build_object(
    'input', jsonb_build_object(
      'item_id', v_item.id, 'item_code', v_item.code, 'item_name', v_item.name,
      'quantity', p_quantity, 'uom', p_uom,
      'total_kg', round(v_total_kg, 4),
      'total_units', CASE WHEN v_target_g > 0 THEN round(v_total_units, 2) ELSE NULL END
    ),
    'equivalents', jsonb_build_object(
      'units',  CASE WHEN v_target_g > 0 THEN round(v_total_units, 2) ELSE NULL END,
      'kg',     round(v_total_kg, 2),
      'inner',  CASE WHEN v_target_g > 0 THEN round(v_total_units / v_upi, 2) ELSE NULL END,
      'outer',  CASE WHEN v_target_g > 0 THEN round(v_total_units / v_upi / v_ipo, 2) ELSE NULL END,
      'pallet', CASE WHEN v_target_g > 0 THEN round(v_total_units / v_upi / v_ipo / v_opp, 3) ELSE NULL END
    ),
    'cascade',       COALESCE(v_cascade, '[]'::jsonb),
    'shopping_list', COALESCE(v_shopping, '[]'::jsonb),
    'totals', jsonb_build_object(
      'total_cost', round(COALESCE(v_total_cost, 0), 2),
      'cost_per_unit', CASE WHEN v_total_units > 0 THEN round(COALESCE(v_total_cost, 0) / v_total_units, 4) ELSE NULL END,
      'cost_per_kg',   CASE WHEN v_total_kg    > 0 THEN round(COALESCE(v_total_cost, 0) / v_total_kg,    4) ELSE NULL END
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.test_product_cascade(uuid, numeric, text) TO authenticated;
