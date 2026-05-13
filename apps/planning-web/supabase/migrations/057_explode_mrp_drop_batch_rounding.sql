-- ============================================================================
-- 057  EXPLODE_MRP — drop batch-size rounding (batch_size becomes indicator-only)
-- ----------------------------------------------------------------------------
-- Per Tino: items.default_batch_size should only be a *suggestion* — what an
-- ideal batch looks like — not something that drives planning math.
--
-- Previous behaviour rounded net requirements UP to the nearest whole batch
-- (CEIL(net / batch_size) * batch_size), then exposed the rounding overshoot
-- as `surplus_qty`. That meant a 0.45kg net need on an item with a 100kg batch
-- size became a 100kg planned production order, which inflated downstream
-- raw-material requirements through the recursive explosion as well.
--
-- After this migration:
--   - planned_qty       = net_required_qty (no rounding)
--   - surplus_qty       = 0
--   - rounded_batches   = NULL (no longer computed)
--   - suggested_batches = NULL (no longer computed)
--   - standard_batch_size stays populated from items.default_batch_size so the
--     dept modals can still SHOW it as a hint ("ideal batch is 100kg").
--
-- The recursive parent-chain BOM-fallback logic introduced in 055 is preserved
-- verbatim — only the per-row math at the bottom changes.
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
    -- Anchor: demand lines, netted by FG SOH up front.
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

    -- Branch A: explode BOM normally.
    SELECT
      bl.component_item_id,
      (be.required_qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
        * (bl.qty_per_batch / NULLIF(bh.reference_batch_size, 0)),
      be.depth + 1,
      FALSE
    FROM bom_explosion be
    JOIN public.bom_headers bh ON bh.item_id = be.item_id AND bh.is_active = true
    JOIN public.bom_lines   bl ON bl.bom_header_id = bh.id
    WHERE be.depth < 12 AND be.required_qty > 0

    UNION ALL

    -- Branch B: walk to parent when item has no BOM (1:1 inheritance).
    SELECT
      i.parent_item_id,
      be.required_qty,
      be.depth + 1,
      TRUE
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
    COALESCE(NULLIF(i.department, ''), i.item_type::text)                    AS department,
    (SELECT id FROM public.bom_headers WHERE item_id = a.item_id AND is_active = true LIMIT 1) AS bom_id,
    a.gross                                                                  AS required_qty,
    COALESCE(i.current_stock, 0)                                             AS on_hand_qty,
    GREATEST(0, a.gross - COALESCE(i.current_stock, 0))                      AS net_required_qty,
    i.unit                                                                   AS unit,
    -- standard_batch_size kept as INFORMATIONAL — the operator can still see
    -- "ideal batch ~100kg" in the dept modal. NOT consumed by planning math.
    i.default_batch_size                                                     AS standard_batch_size,
    NULL::numeric                                                            AS suggested_batches,
    NULL::int                                                                AS rounded_batches,
    -- planned_qty = net_required_qty (no batch rounding).
    GREATEST(0, a.gross - COALESCE(i.current_stock, 0))                      AS planned_qty,
    -- No batch rounding → no surplus from rounding.
    0::numeric                                                               AS surplus_qty
  FROM agg a
  JOIN public.items i ON i.id = a.item_id;
END;
$$;
