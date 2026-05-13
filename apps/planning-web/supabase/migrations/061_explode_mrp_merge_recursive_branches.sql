-- ============================================================================
-- 061  EXPLODE_MRP — merge the two recursive branches into a single LEFT JOIN
-- ----------------------------------------------------------------------------
-- Migration 055 introduced two recursive branches in the WITH RECURSIVE
-- bom_explosion CTE:
--    Branch A — explode BOM (item HAS an active BOM)
--    Branch B — walk to parent (item has NO BOM)
--
-- PostgreSQL's WITH RECURSIVE only accepts ONE non-recursive term and ONE
-- recursive term joined by ONE UNION/UNION ALL. With three branches joined
-- by two UNION ALLs, the parser treats the first two branches as the
-- non-recursive group and rejects the recursive self-reference inside the
-- second branch:
--
--    "recursive reference to query 'bom_explosion' must not appear within
--     its non-recursive term"
--
-- Fix: collapse Branch A + Branch B into ONE recursive term using LEFT JOIN
-- on bom_headers/bom_lines. The branches are mutually exclusive per item
-- (either it has a BOM or it doesn't), so merging is exact.
--
--   - If LEFT JOIN finds a bom_lines row → Branch A: yield/ratio math, target
--     is the component_item_id.
--   - If LEFT JOIN finds NO bom_headers (bh.id IS NULL) AND items has a
--     parent_item_id → Branch B: 1:1 propagation up to the parent.
--   - Else: this item is a leaf (raw material, packaging, no BOM, no parent)
--     and the WHERE clause filters it out.
--
-- Same behaviour as 055/057, just legal syntax.
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
    -- ── ANCHOR (non-recursive term) ──
    -- Demand lines, netted by FG SOH up front.
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

    -- ── RECURSIVE TERM (single SELECT with both branches merged) ──
    -- LEFT JOIN to bom_headers + bom_lines. If BOM exists we get one row
    -- per component (Branch A); if not, bl/bh are NULL and we fall through
    -- to the parent-chain (Branch B) via the COALESCE / CASE below.
    SELECT
      COALESCE(bl.component_item_id, i.parent_item_id) AS item_id,
      CASE
        WHEN bl.component_item_id IS NOT NULL THEN
          -- Branch A: BOM explosion math
          (be.required_qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
            * (bl.qty_per_batch / NULLIF(bh.reference_batch_size, 0))
        ELSE
          -- Branch B: 1:1 propagation up to parent
          be.required_qty
      END AS required_qty,
      be.depth + 1                                                 AS depth,
      (bl.component_item_id IS NULL)                               AS via_parent
    FROM bom_explosion be
    JOIN public.items i  ON i.id = be.item_id
    LEFT JOIN public.bom_headers bh
           ON bh.item_id = be.item_id AND bh.is_active = true
    LEFT JOIN public.bom_lines   bl
           ON bl.bom_header_id = bh.id
    WHERE be.depth < 12
      AND be.required_qty > 0
      AND (
        -- Either we found a BOM line to explode (Branch A)…
        bl.component_item_id IS NOT NULL
        -- …or there is no BOM at all and the item has a parent (Branch B).
        OR (bh.id IS NULL AND i.parent_item_id IS NOT NULL)
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
    COALESCE(NULLIF(i.department, ''), i.item_type::text)              AS department,
    (SELECT id FROM public.bom_headers
       WHERE item_id = a.item_id AND is_active = true LIMIT 1)         AS bom_id,
    a.gross                                                            AS required_qty,
    COALESCE(i.current_stock, 0)                                       AS on_hand_qty,
    GREATEST(0, a.gross - COALESCE(i.current_stock, 0))                AS net_required_qty,
    i.unit                                                             AS unit,
    -- batch_size is INDICATOR-ONLY (per migration 057) — display hint only.
    i.default_batch_size                                               AS standard_batch_size,
    NULL::numeric                                                      AS suggested_batches,
    NULL::int                                                          AS rounded_batches,
    -- planned_qty = net (no batch rounding); surplus = 0.
    GREATEST(0, a.gross - COALESCE(i.current_stock, 0))                AS planned_qty,
    0::numeric                                                         AS surplus_qty
  FROM agg a
  JOIN public.items i ON i.id = a.item_id;
END;
$$;
