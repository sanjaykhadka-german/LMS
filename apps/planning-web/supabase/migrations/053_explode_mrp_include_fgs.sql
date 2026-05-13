-- ============================================================================
-- 053  EXPLODE_MRP — also write FG rows so Packing card populates
-- ----------------------------------------------------------------------------
-- The previous version EXCLUDED demand items (FGs) from mrp_results because
-- they're "demand inputs, not outputs". But operators need to see FGs in the
-- Packing department card — packing IS what FGs go through. So we now write
-- FG rows too, with the same gross/SOH/net + batch maths.
--
-- The exclusion is removed from the final SELECT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.explode_mrp(p_demand_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.demand_plans WHERE id = p_demand_plan_id;
  DELETE FROM public.mrp_results WHERE demand_plan_id = p_demand_plan_id;

  INSERT INTO public.mrp_results (
    demand_plan_id, item_id, department, bom_id,
    required_qty, on_hand_qty, net_required_qty, unit,
    standard_batch_size, suggested_batches, rounded_batches,
    planned_qty, surplus_qty
  )
  WITH RECURSIVE bom_explosion AS (
    SELECT
      dl.item_id,
      GREATEST(0,
        COALESCE(dl.planned_qty_kg, dl.planned_weight_kg, 0) - COALESCE(i.current_stock, 0)
      )::numeric AS required_qty,
      0 AS depth
    FROM public.demand_lines dl
    JOIN public.items i ON i.id = dl.item_id
    WHERE dl.demand_plan_id = p_demand_plan_id

    UNION ALL

    SELECT
      bl.component_item_id AS item_id,
      (be.required_qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
        * (bl.qty_per_batch / NULLIF(bh.reference_batch_size, 0)) AS required_qty,
      be.depth + 1
    FROM bom_explosion be
    JOIN public.bom_headers bh ON bh.item_id = be.item_id AND bh.is_active = true
    JOIN public.bom_lines   bl ON bl.bom_header_id = bh.id
    WHERE be.depth < 10
      AND be.required_qty > 0
  ),
  agg AS (
    SELECT be.item_id, SUM(be.required_qty) AS gross
    FROM bom_explosion be
    GROUP BY be.item_id
  )
  SELECT
    p_demand_plan_id,
    a.item_id,
    COALESCE(NULLIF(i.department, ''), i.item_type::text) AS department,
    (SELECT id FROM public.bom_headers WHERE item_id = a.item_id AND is_active = true LIMIT 1) AS bom_id,
    a.gross AS required_qty,
    COALESCE(i.current_stock, 0) AS on_hand_qty,
    GREATEST(0, a.gross - COALESCE(i.current_stock, 0)) AS net_required_qty,
    i.unit,
    i.default_batch_size AS standard_batch_size,
    CASE WHEN i.default_batch_size > 0
      THEN GREATEST(0, a.gross - COALESCE(i.current_stock, 0)) / i.default_batch_size
      ELSE NULL
    END AS suggested_batches,
    CASE WHEN i.default_batch_size > 0
      THEN CEIL(GREATEST(0, a.gross - COALESCE(i.current_stock, 0)) / i.default_batch_size)::int
      ELSE NULL
    END AS rounded_batches,
    CASE WHEN i.default_batch_size > 0
      THEN CEIL(GREATEST(0, a.gross - COALESCE(i.current_stock, 0)) / i.default_batch_size) * i.default_batch_size
      ELSE GREATEST(0, a.gross - COALESCE(i.current_stock, 0))
    END AS planned_qty,
    CASE WHEN i.default_batch_size > 0
      THEN CEIL(GREATEST(0, a.gross - COALESCE(i.current_stock, 0)) / i.default_batch_size) * i.default_batch_size
           - GREATEST(0, a.gross - COALESCE(i.current_stock, 0))
      ELSE 0
    END AS surplus_qty
  FROM agg a
  JOIN public.items i ON i.id = a.item_id;
END;
$$;
