-- ============================================================================
-- 064  EXPLODE_MRP — dual-track math (recipe % + packaging unit-basis)
-- ----------------------------------------------------------------------------
-- New rules:
--
--   For each demanded item, recursively walk its tree producing per-item
--   gross requirements. Each iteration produces successor rows from TWO
--   sources, merged into a single recursive term:
--
--   1) IMPLICIT PARENT LINK: if items.parent_item_id is set, automatically
--      pull 1 kg of parent per 1 kg of child. This is what makes
--      "FG → WIPF → WIP → raw materials" cascade without anyone writing
--      explicit parent lines into the BOMs.
--
--   2) BOM LINES: for each line of the item's active BOM, branch on the
--      component's consumed_in_weight flag:
--
--      a) consumed_in_weight = TRUE  (recipe line, e.g. Pork at 55%):
--           component_qty = parent_kg × qty_per_batch / 100
--
--      b) consumed_in_weight = FALSE (packaging/casing/consumable, with basis):
--           parent_pieces  = parent_kg × 1000 / parent.target_weight_g
--           parent_inners  = parent_pieces / parent.units_per_inner
--           parent_outers  = parent_pieces / parent.units_per_outer
--           parent_pallets = parent_pieces / parent.units_per_pallet
--
--           component_qty = qty_per_batch × (parent value in matching basis)
--           Falls back to parent_kg when basis = per_kg or basis IS NULL.
--
-- Aggregation, SOH netting, and indicator-only batch_size carry over from
-- migrations 057+061+062.
--
-- Both successor sources are merged via a single LATERAL UNION ALL inside
-- the recursive term so PostgreSQL only sees one anchor + one recursive term
-- (the "recursive reference in non-recursive term" trap from migration 055
-- doesn't apply).
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
    -- For each row in `be`, produce successor rows from a LATERAL union of
    -- (implicit parent link) ∪ (BOM lines). The SELECT shape is identical
    -- so they merge cleanly.
    SELECT
      successor.item_id,
      successor.qty,
      be.depth + 1
    FROM bom_explosion be
    JOIN public.items parent ON parent.id = be.item_id
    JOIN LATERAL (
      ----------------------------------------------------------------
      -- (a) Implicit parent link: 1 kg of parent per 1 kg of self.
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
          -- Recipe line: qty is a percentage of parent weight
          WHEN comp.consumed_in_weight THEN
            be.required_qty * COALESCE(bl.percentage, bl.qty_per_batch) / 100.0

          -- Packaging line, per_piece basis
          WHEN bl.basis = 'per_piece' AND parent.target_weight_g > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g) * bl.qty_per_batch

          -- Packaging line, per_inner basis
          WHEN bl.basis = 'per_inner' AND parent.target_weight_g > 0 AND parent.units_per_inner > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_inner) * bl.qty_per_batch

          -- Packaging line, per_outer basis
          WHEN bl.basis = 'per_outer' AND parent.target_weight_g > 0 AND parent.units_per_outer > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_outer) * bl.qty_per_batch

          -- Packaging line, per_pallet basis
          WHEN bl.basis = 'per_pallet' AND parent.target_weight_g > 0 AND parent.units_per_pallet > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_pallet) * bl.qty_per_batch

          -- Packaging line, per_kg basis (or basis null = legacy fallback)
          ELSE
            be.required_qty * bl.qty_per_batch
        END AS qty
      FROM public.bom_headers bh
      JOIN public.bom_lines   bl   ON bl.bom_header_id = bh.id
      JOIN public.items       comp ON comp.id = bl.component_item_id
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
    -- batch_size is INDICATOR-ONLY (per migration 057) — display hint only.
    i.default_batch_size                                               AS standard_batch_size,
    NULL::numeric                                                      AS suggested_batches,
    NULL::int                                                          AS rounded_batches,
    GREATEST(0, a.gross - COALESCE(i.current_stock, 0))                AS planned_qty,
    0::numeric                                                         AS surplus_qty
  FROM agg a
  JOIN public.items i ON i.id = a.item_id;
END;
$$;
