-- ============================================================================
-- 065  EXPLODE_MRP — normalize recipe lines so qty units don't matter
-- ----------------------------------------------------------------------------
-- Per Tino: the user enters recipe quantities in their natural units (kg per
-- batch, percentages, parts-of-100, whatever) and the system should figure
-- out each line's share automatically. Strict "qty_per_batch IS the
-- percentage" only works when the user happens to enter clean 0–100 numbers.
-- Anyone typing "1600 kg of WIPF" sees a 1600% explosion under the old rule.
--
-- New rule for RECIPE lines (component.consumed_in_weight = true):
--
--     line_pct  = qty_per_batch / SUM(qty_per_batch over all recipe lines)
--     line_kg   = parent_kg × line_pct                  (yield_factor still applied)
--
-- This works whether the user enters:
--   - 55, 15, 12, 10, ... summing to 100 (% directly) — ratio unchanged
--   - 550, 150, 120, 100, ... summing to 1000 (10×) — ratio unchanged
--   - 27.5, 7.5, 6, 5 ... summing to 50 (per-50kg batch) — ratio unchanged
--   - Mixed scale across BOMs — each BOM's recipe normalizes to itself
--
-- PACKAGING lines (consumed_in_weight = false) are unchanged: still use
-- bom_lines.basis (per_piece / per_inner / per_outer / per_pallet / per_kg)
-- and never participate in the recipe normalization.
--
-- Implicit parent link is also unchanged: 1 kg of parent per 1 kg of self
-- (when items.parent_item_id is set). This means a packed-FG BOM with only
-- packaging lines still pulls its parent WIPF correctly.
--
-- Implementation note: the recipe sum is computed ONCE per parent-item per
-- iteration via a window over the BOM's recipe lines, then used as the
-- divisor in the line's qty calc.
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
    -- ── ANCHOR ──────────────────────────────────────────────────────────
    SELECT
      dl.item_id,
      GREATEST(0,
        COALESCE(dl.planned_qty_kg, dl.planned_weight_kg, 0) - COALESCE(i.current_stock, 0)
      )::numeric AS required_qty,
      0          AS depth
    FROM public.demand_lines dl
    JOIN public.items i ON i.id = dl.item_id
    WHERE dl.demand_plan_id = p_demand_plan_id

    UNION ALL

    -- ── RECURSIVE TERM ──────────────────────────────────────────────────
    SELECT
      successor.item_id,
      successor.qty,
      be.depth + 1
    FROM bom_explosion be
    JOIN public.items parent ON parent.id = be.item_id
    JOIN LATERAL (
      ----------------------------------------------------------------
      -- (a) IMPLICIT parent link: 1 kg of parent per 1 kg of self.
      ----------------------------------------------------------------
      SELECT
        parent.parent_item_id AS item_id,
        be.required_qty       AS qty
      WHERE parent.parent_item_id IS NOT NULL

      UNION ALL

      ----------------------------------------------------------------
      -- (b) BOM lines, branching on component.consumed_in_weight.
      ----------------------------------------------------------------
      SELECT
        bl.component_item_id AS item_id,
        CASE
          -- RECIPE line: qty is normalized over the BOM's recipe-line total.
          WHEN comp.consumed_in_weight THEN
            (be.required_qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
              * (bl.qty_per_batch / NULLIF(line_totals.recipe_sum, 0))

          -- PACKAGING line, basis-aware (unchanged from migration 064).
          WHEN bl.basis = 'per_piece' AND parent.target_weight_g > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g) * bl.qty_per_batch
          WHEN bl.basis = 'per_inner' AND parent.target_weight_g > 0 AND parent.units_per_inner > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_inner) * bl.qty_per_batch
          WHEN bl.basis = 'per_outer' AND parent.target_weight_g > 0 AND parent.units_per_outer > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_outer) * bl.qty_per_batch
          WHEN bl.basis = 'per_pallet' AND parent.target_weight_g > 0 AND parent.units_per_pallet > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_pallet) * bl.qty_per_batch
          ELSE
            be.required_qty * bl.qty_per_batch
        END AS qty
      FROM public.bom_headers bh
      JOIN public.bom_lines   bl   ON bl.bom_header_id = bh.id
      JOIN public.items       comp ON comp.id = bl.component_item_id
      -- Pre-computed sum of qty_per_batch across the BOM's recipe lines
      -- (only weight components count). Used as the normalization divisor
      -- so a BOM entered with values like "1600 kg of WIPF" still resolves
      -- to "100% of parent" automatically.
      LEFT JOIN LATERAL (
        SELECT SUM(bl2.qty_per_batch) AS recipe_sum
        FROM public.bom_lines bl2
        JOIN public.items     comp2 ON comp2.id = bl2.component_item_id
        WHERE bl2.bom_header_id = bh.id
          AND comp2.consumed_in_weight = true
      ) line_totals ON true
      WHERE bh.item_id = be.item_id
        AND bh.is_active = true
    ) successor ON successor.item_id IS NOT NULL
    WHERE be.depth < 12
      AND be.required_qty > 0
      AND successor.qty > 0
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
    i.default_batch_size                                               AS standard_batch_size,
    NULL::numeric                                                      AS suggested_batches,
    NULL::int                                                          AS rounded_batches,
    GREATEST(0, a.gross - COALESCE(i.current_stock, 0))                AS planned_qty,
    0::numeric                                                         AS surplus_qty
  FROM agg a
  JOIN public.items i ON i.id = a.item_id;
END;
$$;
