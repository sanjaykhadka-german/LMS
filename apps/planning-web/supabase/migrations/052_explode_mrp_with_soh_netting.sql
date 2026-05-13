-- ============================================================================
-- 052  EXPLODE_MRP — net requirements (gross − on-hand SOH)
-- ----------------------------------------------------------------------------
-- Adds two columns to mrp_results: on_hand_qty + net_required_qty.
-- Rewrites explode_mrp so:
--   1. Demand lines (FG) get their gross qty reduced by FG SOH at the source
--      → upstream cascade is computed off the *net* FG demand, so the whole
--      tree shrinks accordingly.
--   2. At every produced/purchased level, mrp_results captures the item's
--      on_hand (= items.current_stock at MRP time) and computes
--      net_required_qty = max(0, required_qty - on_hand_qty).
--   3. Batch maths (suggested / rounded / planned / surplus) now use NET,
--      not gross — you only batch up what you actually need to make.
--
-- Intermediate-level SOH cascade (where surplus WIP suppresses RM demand)
-- is a future iteration; this v1 nets SOH per item at the end of the cascade,
-- which gives operators the right "what to produce / buy" number for the
-- common case while staying tractable for the recursive CTE.
-- ============================================================================

ALTER TABLE public.mrp_results
  ADD COLUMN IF NOT EXISTS on_hand_qty       numeric,
  ADD COLUMN IF NOT EXISTS net_required_qty  numeric;

CREATE OR REPLACE FUNCTION public.explode_mrp(p_demand_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.demand_plans WHERE id = p_demand_plan_id;

  -- Clear previous results for this plan
  DELETE FROM public.mrp_results WHERE demand_plan_id = p_demand_plan_id;

  INSERT INTO public.mrp_results (
    demand_plan_id, item_id, department, bom_id,
    required_qty, on_hand_qty, net_required_qty, unit,
    standard_batch_size, suggested_batches, rounded_batches,
    planned_qty, surplus_qty
  )
  WITH RECURSIVE bom_explosion AS (
    -- Base: finished goods from demand lines, NETTED against FG SOH at source.
    SELECT
      dl.item_id,
      GREATEST(
        0,
        COALESCE(dl.planned_qty_kg, dl.planned_weight_kg, 0) - COALESCE(i.current_stock, 0)
      )::numeric AS required_qty,
      'finished_good'::text AS level,
      0 AS depth
    FROM public.demand_lines dl
    JOIN public.items i ON i.id = dl.item_id
    WHERE dl.demand_plan_id = p_demand_plan_id

    UNION ALL

    -- Recurse: explode components via active BOM.
    SELECT
      bl.component_item_id AS item_id,
      (be.required_qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
        * (bl.qty_per_batch / NULLIF(bh.reference_batch_size, 0)) AS required_qty,
      i.department AS level,
      be.depth + 1
    FROM bom_explosion be
    JOIN public.bom_headers bh ON bh.item_id = be.item_id AND bh.is_active = true
    JOIN public.bom_lines   bl ON bl.bom_header_id = bh.id
    JOIN public.items       i  ON i.id = bl.component_item_id
    WHERE be.depth < 10  -- safety: max 10 levels deep
      AND be.required_qty > 0  -- if FG net is zero, no need to explode
  ),
  agg AS (
    -- Aggregate gross requirements per item across all explosion paths.
    -- Exclude FGs (they're demand inputs, not MRP outputs).
    SELECT
      be.item_id,
      SUM(be.required_qty) AS gross
    FROM bom_explosion be
    WHERE be.item_id NOT IN (
      SELECT item_id FROM public.demand_lines WHERE demand_plan_id = p_demand_plan_id
    )
    GROUP BY be.item_id
  )
  SELECT
    p_demand_plan_id,
    a.item_id,
    COALESCE(i.department, i.item_type::text) AS department,
    (SELECT id FROM public.bom_headers WHERE item_id = a.item_id AND is_active = true LIMIT 1) AS bom_id,
    a.gross AS required_qty,
    COALESCE(i.current_stock, 0) AS on_hand_qty,
    GREATEST(0, a.gross - COALESCE(i.current_stock, 0)) AS net_required_qty,
    i.unit,
    i.default_batch_size AS standard_batch_size,
    -- Batch maths use NET requirements: don't make what's already in stock.
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
