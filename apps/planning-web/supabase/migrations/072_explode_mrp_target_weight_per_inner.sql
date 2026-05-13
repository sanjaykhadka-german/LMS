-- ============================================================================
-- 072  EXPLODE_MRP — target_weight_g is PER INNER (not per piece)
-- ----------------------------------------------------------------------------
-- Semantic clarification + math fix.
--
-- Previous code (migration 067) treated items.target_weight_g as the weight
-- of a SINGLE PIECE (e.g. one sausage). The operator-facing field has always
-- meant the weight of one INNER PACK — for items with units_per_inner = 1
-- (a single ham per pack) the two are identical, but for multi-piece packs
-- (e.g. a 3 × 100 g pack of chorizo) target_weight_g = 300 and the per-piece
-- weight is 300 ÷ 3 = 100 g. Tracey's data has been entered with this
-- interpretation throughout, so the per_piece / per_inner / per_outer /
-- per_pallet basis formulas in explode_mrp need to be updated to match.
--
-- New definitions:
--   piece_weight_g = target_weight_g / COALESCE(units_per_inner, 1)
--   pieces_in(parent, kg)  = kg × 1000 × COALESCE(units_per_inner, 1) / target_weight_g
--   inners_in(parent, kg)  = kg × 1000 / target_weight_g
--   outers_in(parent, kg)  = pieces_in / units_per_outer
--   pallets_in(parent, kg) = pieces_in / units_per_pallet
--
-- Items with units_per_inner = 1 (or null) compute identically to the previous
-- code path — only multi-piece packs see the corrected math.
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
      0          AS depth
    FROM public.demand_lines dl
    JOIN public.items i ON i.id = dl.item_id
    WHERE dl.demand_plan_id = p_demand_plan_id

    UNION ALL

    SELECT
      successor.item_id,
      successor.qty,
      be.depth + 1
    FROM bom_explosion be
    JOIN public.items parent ON parent.id = be.item_id
    JOIN LATERAL (
      SELECT
        parent.parent_item_id AS item_id,
        be.required_qty       AS qty
      WHERE parent.parent_item_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.bom_headers bh_chk
          JOIN public.bom_lines  bl_chk ON bl_chk.bom_header_id = bh_chk.id
          WHERE bh_chk.item_id = be.item_id
            AND bh_chk.is_active = true
            AND bl_chk.component_item_id = parent.parent_item_id
        )

      UNION ALL

      SELECT
        bl.component_item_id,
        CASE
          WHEN comp.consumed_in_weight THEN
            (be.required_qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
              * (bl.qty_per_batch / NULLIF(line_totals.recipe_sum, 0))
          -- per_piece: pieces_in_parent = kg × 1000 × units_per_inner / target_weight_g
          --            (target_weight_g is per INNER; multiply by units_per_inner to get pieces)
          WHEN bl.basis = 'per_piece' AND parent.target_weight_g > 0 THEN
            (be.required_qty * 1000.0 * COALESCE(parent.units_per_inner, 1) / parent.target_weight_g)
              * bl.qty_per_batch
          -- per_inner: inners_in_parent = kg × 1000 / target_weight_g (target IS per inner)
          WHEN bl.basis = 'per_inner' AND parent.target_weight_g > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g)
              * bl.qty_per_batch
          -- per_outer: outers = pieces / units_per_outer
          WHEN bl.basis = 'per_outer' AND parent.target_weight_g > 0
            AND parent.units_per_outer > 0 AND COALESCE(parent.units_per_inner, 1) > 0 THEN
            (be.required_qty * 1000.0 * COALESCE(parent.units_per_inner, 1)
              / (parent.target_weight_g * parent.units_per_outer))
              * bl.qty_per_batch
          -- per_pallet: pallets = pieces / units_per_pallet
          WHEN bl.basis = 'per_pallet' AND parent.target_weight_g > 0
            AND parent.units_per_pallet > 0 AND COALESCE(parent.units_per_inner, 1) > 0 THEN
            (be.required_qty * 1000.0 * COALESCE(parent.units_per_inner, 1)
              / (parent.target_weight_g * parent.units_per_pallet))
              * bl.qty_per_batch
          WHEN bl.basis = 'per_kg' THEN
            be.required_qty * bl.qty_per_batch
          ELSE
            -- LEGACY FALLBACK: basis missing → treat qty as "per 1000 kg of parent"
            be.required_qty * bl.qty_per_batch / 1000.0
        END AS qty
      FROM public.bom_headers bh
      JOIN public.bom_lines   bl   ON bl.bom_header_id = bh.id
      JOIN public.items       comp ON comp.id = bl.component_item_id
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
