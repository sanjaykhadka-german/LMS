-- ============================================================================
-- 062  EXPLODE_MRP — interpret BOM lines as PERCENTAGES of parent qty
-- ----------------------------------------------------------------------------
-- Per Tino's design rule (May 2026):
--   * BOM recipes are stored as percentages of the parent's batch.
--     E.g. "Pork 75cl: 55" means 55% of the WIP weight is Pork 75cl.
--   * `bom_headers.reference_batch_size` and `items.default_batch_size`
--     are display indicators only — they MUST NOT drive any calculation.
--
-- Old formula (used reference_batch_size, which Tino rejected):
--     required_qty = (parent_qty / yield_factor)
--                  * (qty_per_batch / reference_batch_size)
--
-- New formula:
--     required_qty = (parent_qty / yield_factor)
--                  * (COALESCE(bom_lines.percentage, bom_lines.qty_per_batch) / 100)
--
-- Why COALESCE?
--   bom_lines has both `percentage` (newer, explicit) and `qty_per_batch`
--   (legacy) columns. The recipes Tino's already entered live in qty_per_batch
--   as numbers like 55, 15, 1.6, 0.02 — exactly the percentages. So we read
--   percentage first, then fall back to qty_per_batch.
--
-- yield_factor is preserved to account for cook/process loss inside the
-- recipe itself (e.g. yield 0.95 → need 5% more inputs to net to demanded
-- output). Default 1.0 = no loss.
--
-- The recursive structure from migration 061 is unchanged — only the qty math
-- inside the recursive term changes.
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
    -- ── ANCHOR: demand lines, netted by FG SOH up front ──
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

    -- ── RECURSIVE TERM: BOM-explode (Branch A) merged with parent-walk
    --    (Branch B) into one SELECT via LEFT JOIN.
    --
    --    Branch A (BOM line found): qty = parent_qty / yield * (pct / 100)
    --    Branch B (no BOM, has parent): qty = parent_qty (1:1 propagation)
    -- ──
    SELECT
      COALESCE(bl.component_item_id, i.parent_item_id) AS item_id,
      CASE
        WHEN bl.component_item_id IS NOT NULL THEN
          (be.required_qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
            * (COALESCE(bl.percentage, bl.qty_per_batch) / 100.0)
        ELSE
          be.required_qty
      END                                                 AS required_qty,
      be.depth + 1                                        AS depth,
      (bl.component_item_id IS NULL)                      AS via_parent
    FROM bom_explosion be
    JOIN public.items i  ON i.id = be.item_id
    LEFT JOIN public.bom_headers bh
           ON bh.item_id = be.item_id AND bh.is_active = true
    LEFT JOIN public.bom_lines   bl
           ON bl.bom_header_id = bh.id
    WHERE be.depth < 12
      AND be.required_qty > 0
      AND (
        bl.component_item_id IS NOT NULL
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
    -- batch_size is INDICATOR-ONLY. Surfaced for display only; no logic.
    i.default_batch_size                                               AS standard_batch_size,
    NULL::numeric                                                      AS suggested_batches,
    NULL::int                                                          AS rounded_batches,
    GREATEST(0, a.gross - COALESCE(i.current_stock, 0))                AS planned_qty,
    0::numeric                                                         AS surplus_qty
  FROM agg a
  JOIN public.items i ON i.id = a.item_id;
END;
$$;
