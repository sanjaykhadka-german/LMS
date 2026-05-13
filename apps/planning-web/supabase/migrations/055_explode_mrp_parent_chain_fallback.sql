-- ============================================================================
-- 055  EXPLODE_MRP — parent-chain BOM fallback
-- ----------------------------------------------------------------------------
-- Why:
--   Many child SKUs (e.g. 2015.125.02 FG, 2015.125 WIPF) don't have their own
--   BOM — they inherit the recipe of their parent (2015 base WIP). The previous
--   recursive CTE INNER-JOINed bom_headers, so any item missing a BOM stopped
--   the entire downstream explosion: dept cards stayed empty, raw materials
--   weren't aggregated, and operators thought MRP was broken.
--
-- Fix:
--   The recursion now has TWO branches:
--
--     Branch A — explode BOM (unchanged):
--       If item has an active BOM, walk its bom_lines, applying yield + ratio.
--
--     Branch B — walk parent (NEW):
--       If item has NO active BOM but DOES have a parent_item_id, propagate
--       the SAME kg requirement up to the parent at a 1:1 ratio. This treats
--       parent/child SKUs as variants of the same recipe (the typical case in
--       butchery: a 1kg pack vs a 250g pack of "Bratwurst" both pull from the
--       same mince). When we eventually hit an ancestor with a BOM, Branch A
--       fires and the raw materials roll up properly.
--
--   Each ancestor visited via Branch B still emits a row in the working set,
--   so they appear in the final mrp_results — meaning intermediate WIP/WIPF
--   rows show up in their dept cards even though they don't carry a BOM.
--
-- Safety:
--   - depth < 12 (raised from 10 to allow the extra parent hops without
--     truncating real recipe chains).
--   - via_parent flag isn't strictly needed for correctness, but kept here as
--     a debugging hint if anything looks odd in mrp_results.
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
    -- ── ANCHOR ──
    -- Demand lines, netted by FG SOH up front (so we don't over-explode).
    SELECT
      dl.item_id,
      GREATEST(0,
        COALESCE(dl.planned_qty_kg, dl.planned_weight_kg, 0) - COALESCE(i.current_stock, 0)
      )::numeric AS required_qty,
      0          AS depth,
      FALSE      AS via_parent
    FROM public.demand_lines dl
    JOIN public.items i ON i.id = dl.item_id
    WHERE dl.demand_plan_id = p_demand_plan_id

    UNION ALL

    -- ── BRANCH A: explode BOM (component requirements) ──
    SELECT
      bl.component_item_id AS item_id,
      (be.required_qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
        * (bl.qty_per_batch / NULLIF(bh.reference_batch_size, 0)) AS required_qty,
      be.depth + 1 AS depth,
      FALSE        AS via_parent
    FROM bom_explosion be
    JOIN public.bom_headers bh ON bh.item_id = be.item_id AND bh.is_active = true
    JOIN public.bom_lines   bl ON bl.bom_header_id = bh.id
    WHERE be.depth < 12
      AND be.required_qty > 0

    UNION ALL

    -- ── BRANCH B: walk to parent when no BOM exists (1:1 inheritance) ──
    SELECT
      i.parent_item_id AS item_id,
      be.required_qty  AS required_qty,   -- 1:1 propagation
      be.depth + 1     AS depth,
      TRUE             AS via_parent
    FROM bom_explosion be
    JOIN public.items i ON i.id = be.item_id
    WHERE be.depth < 12
      AND be.required_qty > 0
      AND i.parent_item_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.bom_headers bh
        WHERE bh.item_id = be.item_id AND bh.is_active = true
      )
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
