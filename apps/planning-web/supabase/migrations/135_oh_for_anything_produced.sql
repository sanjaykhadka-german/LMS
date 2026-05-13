-- ============================================================================
-- Migration 135 — Overhead applies to anything we PRODUCE
--
-- Tino May 2026: spotted a WIPP-by-name item (2052.060.6) typed as
-- `packaging` (operationally a WIPP) where OH was zeroed out, while its
-- parent WIP (2052) correctly absorbed OH. The old rule (`item_type IN
-- (finished_good, wip, wipf, wipp)`) was too narrow — it skipped any
-- "we produce this but the type tag says something else" item.
--
-- New rule: OH applies whenever the item has an ACTIVE BOM (i.e., it's
-- produced by us). Items without a BOM (purchased raw materials, plain
-- packaging) are still excluded. This matches the operational reality:
-- if it goes through our plant, it absorbs plant overhead.
--
-- Touches: v_item_landed_cost_v3 + cost_breakdown_v2 RPC.
-- ============================================================================

-- ─── v_item_landed_cost_v3 — OH rule update ──────────────────────────
DROP VIEW IF EXISTS v_item_landed_cost_v3;

CREATE VIEW v_item_landed_cost_v3 AS
WITH RECURSIVE explode AS (
  SELECT
    i.id            AS root_id,
    i.id            AS node_id,
    1.0::numeric    AS qty_at_node,
    0               AS depth,
    ARRAY[i.id]::uuid[] AS path,
    i.target_weight_g  AS inh_target_weight_g,
    i.units_per_inner  AS inh_units_per_inner,
    i.units_per_outer  AS inh_units_per_outer,
    i.units_per_pallet AS inh_units_per_pallet
  FROM items i
  UNION ALL
  SELECT
    e.root_id, bl.component_item_id,
    CASE
      WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN
        (e.qty_at_node / NULLIF(COALESCE(bh.yield_factor, 1.0), 0)) * (bl.percentage / 100.0)
      WHEN bl.unit = 'kg' THEN
        (e.qty_at_node / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
          * (bl.qty_per_batch / NULLIF((
              SELECT SUM(bl2.qty_per_batch) FROM bom_lines bl2
              WHERE bl2.bom_header_id = bh.id AND bl2.unit = 'kg'
            ), 0))
      WHEN bl.basis = 'per_kg' THEN e.qty_at_node * bl.qty_per_batch
      WHEN bl.basis = 'per_piece' AND e.inh_target_weight_g > 0 THEN
        (e.qty_at_node * 1000.0 / e.inh_target_weight_g) * bl.qty_per_batch
      WHEN bl.basis = 'per_inner' AND e.inh_target_weight_g > 0 AND e.inh_units_per_inner > 0 THEN
        (e.qty_at_node * 1000.0 / e.inh_target_weight_g / e.inh_units_per_inner) * bl.qty_per_batch
      WHEN bl.basis = 'per_outer' AND e.inh_target_weight_g > 0 AND e.inh_units_per_outer > 0 THEN
        (e.qty_at_node * 1000.0 / e.inh_target_weight_g / e.inh_units_per_outer) * bl.qty_per_batch
      WHEN bl.basis = 'per_pallet' AND e.inh_target_weight_g > 0 AND e.inh_units_per_pallet > 0 THEN
        (e.qty_at_node * 1000.0 / e.inh_target_weight_g / e.inh_units_per_pallet) * bl.qty_per_batch
      ELSE NULL
    END,
    e.depth + 1,
    e.path || bl.component_item_id,
    COALESCE(child.target_weight_g, e.inh_target_weight_g),
    COALESCE(child.units_per_inner, e.inh_units_per_inner),
    COALESCE(child.units_per_outer, e.inh_units_per_outer),
    COALESCE(child.units_per_pallet, e.inh_units_per_pallet)
  FROM explode e
  JOIN bom_headers bh ON bh.item_id = e.node_id AND bh.is_active = true
  JOIN bom_lines bl ON bl.bom_header_id = bh.id
  JOIN items child ON child.id = bl.component_item_id
  WHERE e.depth < 12 AND NOT (bl.component_item_id = ANY(e.path))
),
rm_rollup AS (
  SELECT e.root_id AS item_id,
    SUM(COALESCE(e.qty_at_node, 0) * COALESCE(ich.effective_cost, 0)) AS rm_cost_per_unit,
    COUNT(DISTINCT e.node_id) AS component_count,
    SUM(CASE WHEN COALESCE(ich.effective_cost, 0) > 0 THEN 0 ELSE 1 END) AS leaves_missing_cost,
    SUM(CASE WHEN e.qty_at_node IS NULL THEN 1 ELSE 0 END) AS leaves_missing_hierarchy
  FROM explode e
  LEFT JOIN v_item_cost_health ich ON ich.item_id = e.node_id
  WHERE NOT EXISTS (SELECT 1 FROM bom_headers bh
                    WHERE bh.item_id = e.node_id AND bh.is_active = true)
  GROUP BY e.root_id
),
labour_rollup AS (
  SELECT e.root_id AS item_id,
    SUM(COALESCE(e.qty_at_node, 0) * COALESCE(rs.total_labour_per_kg, 0)) AS labour_cost_per_unit,
    bool_or(rs.any_hierarchy_missing) AS labour_hierarchy_missing
  FROM explode e
  JOIN bom_headers bh ON bh.item_id = e.node_id AND bh.is_active = true
  JOIN v_bom_routing_cost_summary rs ON rs.bom_header_id = bh.id
  GROUP BY e.root_id
)
SELECT
  i.id                                            AS item_id,
  i.code, i.name, i.item_type, i.unit,
  i.standard_cost                                 AS manual_standard_cost,
  COALESCE(rm.rm_cost_per_unit, 0)::numeric(14,4) AS rm_cost_per_unit,
  COALESCE(lab.labour_cost_per_unit, 0)::numeric(14,4) AS labour_cost_per_unit,
  -- OH applies to anything we PRODUCE — any item with an active BOM, plus
  -- the producible item-type fallback for tagged-but-no-BOM items. Was
  -- previously type-only which missed packaging-named WIPPs (Tino mig 135).
  CASE
    WHEN EXISTS (SELECT 1 FROM bom_headers bh WHERE bh.item_id = i.id AND bh.is_active = true)
      OR i.item_type IN ('finished_good','wip','wipf','wipp')
      THEN COALESCE(oh.rate_per_kg, 0)
    ELSE 0
  END::numeric(14,4)                              AS overhead_cost_per_unit,
  (COALESCE(rm.rm_cost_per_unit, 0)
   + COALESCE(lab.labour_cost_per_unit, 0)
   + CASE
       WHEN EXISTS (SELECT 1 FROM bom_headers bh WHERE bh.item_id = i.id AND bh.is_active = true)
         OR i.item_type IN ('finished_good','wip','wipf','wipp')
         THEN COALESCE(oh.rate_per_kg, 0) ELSE 0
     END
  )::numeric(14,4)                                AS total_cost_per_unit,
  COALESCE(rm.component_count, 0)                 AS component_count,
  COALESCE(rm.leaves_missing_cost, 0)             AS leaves_missing_cost,
  COALESCE(rm.leaves_missing_hierarchy, 0)        AS leaves_missing_hierarchy,
  COALESCE(lab.labour_hierarchy_missing, false)   AS labour_hierarchy_missing,
  EXISTS (SELECT 1 FROM bom_headers bh
          WHERE bh.item_id = i.id AND bh.is_active = true) AS has_active_bom,
  CASE
    WHEN i.standard_cost IS NOT NULL AND i.standard_cost <> 0
    THEN ROUND((((COALESCE(rm.rm_cost_per_unit, 0)
                + COALESCE(lab.labour_cost_per_unit, 0)
                + CASE
                    WHEN EXISTS (SELECT 1 FROM bom_headers bh WHERE bh.item_id = i.id AND bh.is_active = true)
                      OR i.item_type IN ('finished_good','wip','wipf','wipp')
                      THEN COALESCE(oh.rate_per_kg, 0) ELSE 0
                  END) - i.standard_cost) / i.standard_cost) * 100, 1)
    ELSE NULL
  END                                             AS variance_pct
FROM items i
LEFT JOIN rm_rollup     rm  ON rm.item_id  = i.id
LEFT JOIN labour_rollup lab ON lab.item_id = i.id
LEFT JOIN v_overhead_standard_current oh ON oh.tenant_id = i.tenant_id;

GRANT SELECT ON v_item_landed_cost_v3 TO authenticated;


-- ─── cost_breakdown_v2 — OH rule update ──────────────────────────────
-- The RPC's OH join had the same item_type restriction. Loosen it the
-- same way: anything produced gets OH.
CREATE OR REPLACE FUNCTION public.cost_breakdown_v2(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_result    jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.items WHERE id = p_item_id;
  IF v_tenant_id IS NULL OR v_tenant_id <> my_tenant_id() THEN
    RAISE EXCEPTION 'item not found in your tenant'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  WITH RECURSIVE explode AS (
    SELECT i.id AS root_id, i.id AS node_id, NULL::uuid AS parent_node_id,
           1.0::numeric AS qty_at_node, 0 AS depth, ARRAY[i.id]::uuid[] AS path,
           i.target_weight_g AS inh_target_weight_g,
           i.units_per_inner AS inh_units_per_inner,
           i.units_per_outer AS inh_units_per_outer,
           i.units_per_pallet AS inh_units_per_pallet
    FROM public.items i WHERE i.id = p_item_id
    UNION ALL
    SELECT e.root_id, bl.component_item_id, e.node_id,
      CASE
        WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN
          (e.qty_at_node / NULLIF(COALESCE(bh.yield_factor, 1.0), 0)) * (bl.percentage / 100.0)
        WHEN bl.unit = 'kg' THEN
          (e.qty_at_node / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
            * (bl.qty_per_batch / NULLIF((
                SELECT SUM(bl2.qty_per_batch) FROM public.bom_lines bl2
                WHERE bl2.bom_header_id = bh.id AND bl2.unit = 'kg'
              ), 0))
        WHEN bl.basis = 'per_kg' THEN e.qty_at_node * bl.qty_per_batch
        WHEN bl.basis = 'per_piece' AND e.inh_target_weight_g > 0 THEN
          (e.qty_at_node * 1000.0 / e.inh_target_weight_g) * bl.qty_per_batch
        WHEN bl.basis = 'per_inner' AND e.inh_target_weight_g > 0 AND e.inh_units_per_inner > 0 THEN
          (e.qty_at_node * 1000.0 / e.inh_target_weight_g / e.inh_units_per_inner) * bl.qty_per_batch
        WHEN bl.basis = 'per_outer' AND e.inh_target_weight_g > 0 AND e.inh_units_per_outer > 0 THEN
          (e.qty_at_node * 1000.0 / e.inh_target_weight_g / e.inh_units_per_outer) * bl.qty_per_batch
        WHEN bl.basis = 'per_pallet' AND e.inh_target_weight_g > 0 AND e.inh_units_per_pallet > 0 THEN
          (e.qty_at_node * 1000.0 / e.inh_target_weight_g / e.inh_units_per_pallet) * bl.qty_per_batch
        ELSE NULL
      END,
      e.depth + 1, e.path || bl.component_item_id,
      COALESCE(child.target_weight_g, e.inh_target_weight_g),
      COALESCE(child.units_per_inner, e.inh_units_per_inner),
      COALESCE(child.units_per_outer, e.inh_units_per_outer),
      COALESCE(child.units_per_pallet, e.inh_units_per_pallet)
    FROM explode e
    JOIN public.bom_headers bh ON bh.item_id = e.node_id AND bh.is_active = true
    JOIN public.bom_lines bl ON bl.bom_header_id = bh.id
    JOIN public.items child ON child.id = bl.component_item_id
    WHERE e.depth < 12 AND NOT (bl.component_item_id = ANY(e.path))
  ),
  stage_owners AS (
    SELECT DISTINCT e.node_id AS owner_item_id, bh.id AS bom_header_id,
           MIN(e.depth) OVER (PARTITION BY e.node_id) AS stage_depth
    FROM explode e
    JOIN public.bom_headers bh ON bh.item_id = e.node_id AND bh.is_active = true
  ),
  leaf_at_parent AS (
    SELECT e.parent_node_id AS stage_owner_id, e.node_id AS leaf_id,
           SUM(COALESCE(e.qty_at_node, 0)) AS qty,
           bool_or(e.qty_at_node IS NULL) AS hierarchy_missing
    FROM explode e
    WHERE NOT EXISTS (SELECT 1 FROM public.bom_headers bh
                      WHERE bh.item_id = e.node_id AND bh.is_active = true)
    AND e.parent_node_id IS NOT NULL
    GROUP BY e.parent_node_id, e.node_id
  ),
  bom_qty AS (
    SELECT bh.id AS bom_header_id, SUM(COALESCE(e.qty_at_node, 0)) AS qty_at_node
    FROM explode e
    JOIN public.bom_headers bh ON bh.item_id = e.node_id AND bh.is_active = true
    GROUP BY bh.id
  ),
  stage_labour AS (
    SELECT rs.bom_header_id, rs.department_name,
           SUM(bq.qty_at_node * COALESCE(rs.dollars_per_kg, 0)) AS dept_total
    FROM public.v_bom_routing_cost rs
    JOIN bom_qty bq ON bq.bom_header_id = rs.bom_header_id
    GROUP BY rs.bom_header_id, rs.department_name
  ),
  stage_rm_total AS (
    SELECT lp.stage_owner_id, SUM(lp.qty * COALESCE(ich.effective_cost, 0)) AS rm_total
    FROM leaf_at_parent lp
    LEFT JOIN public.v_item_cost_health ich ON ich.item_id = lp.leaf_id
    GROUP BY lp.stage_owner_id
  ),
  stage_labour_total AS (
    SELECT bom_header_id, SUM(dept_total) AS labour_total FROM stage_labour GROUP BY bom_header_id
  ),
  cost_centres AS (
    SELECT department_name AS centre, SUM(dept_total) AS amount FROM stage_labour GROUP BY department_name
  )
  SELECT jsonb_build_object(
    'item', jsonb_build_object(
      'id', i.id, 'code', i.code, 'name', i.name,
      'item_type', i.item_type, 'unit', i.unit,
      'production_loss_pct', i.production_loss_pct,
      'cooking_loss_pct',    i.cooking_loss_pct,
      'packing_loss_pct',    i.packing_loss_pct,
      'open_pack_pct',       i.open_pack_pct,
      'giveaway_pct',        i.giveaway_pct,
      'process_loss_pct',    i.process_loss_pct
    ),
    'totals', jsonb_build_object(
      'rm', COALESCE(v3.rm_cost_per_unit, 0),
      'labour', COALESCE(v3.labour_cost_per_unit, 0),
      'overhead', COALESCE(v3.overhead_cost_per_unit, 0),
      'total', COALESCE(v3.total_cost_per_unit, 0)
    ),
    'cost_centres', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('centre', centre, 'amount', round(amount, 6)) ORDER BY amount DESC)
      FROM cost_centres WHERE amount > 0
    ), '[]'::jsonb),
    'stages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'bom_header_id', s.bom_header_id, 'node_id', s.owner_item_id,
        'node_code', ni.code, 'node_name', ni.name, 'node_type', ni.item_type,
        'depth', s.stage_depth,
        'losses', jsonb_build_object(
          'production_loss_pct', ni.production_loss_pct,
          'cooking_loss_pct',    ni.cooking_loss_pct,
          'packing_loss_pct',    ni.packing_loss_pct,
          'open_pack_pct',       ni.open_pack_pct,
          'giveaway_pct',        ni.giveaway_pct,
          'process_loss_pct',    ni.process_loss_pct
        ),
        'rm_lines', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'item_id', lp.leaf_id, 'code', li.code, 'name', li.name,
            'item_type', li.item_type, 'unit', li.unit,
            'qty_per_unit', round(lp.qty, 6),
            'unit_cost', round(COALESCE(ich.effective_cost, 0), 4),
            'line_cost', round(lp.qty * COALESCE(ich.effective_cost, 0), 4),
            'supplier_name', sup.name, 'hierarchy_missing', lp.hierarchy_missing
          ) ORDER BY (lp.qty * COALESCE(ich.effective_cost, 0)) DESC, li.code)
          FROM leaf_at_parent lp
          JOIN public.items li ON li.id = lp.leaf_id
          LEFT JOIN public.v_item_cost_health ich ON ich.item_id = lp.leaf_id
          LEFT JOIN public.suppliers sup ON sup.id = ich.cheapest_supplier_id
          WHERE lp.stage_owner_id = s.owner_item_id
        ), '[]'::jsonb),
        'labour_lines', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'department', rs.department_name, 'step_name', rs.step_name,
            'people', rs.people_count, 'minutes', rs.std_minutes,
            'ref_qty', rs.reference_qty, 'ref_basis', rs.reference_basis,
            'dollars_per_kg_at_node', round(COALESCE(rs.dollars_per_kg, 0), 6),
            'qty_at_node', round(bq.qty_at_node, 6),
            'contribution_per_unit', round(bq.qty_at_node * COALESCE(rs.dollars_per_kg, 0), 6),
            'hierarchy_missing', rs.hierarchy_missing
          ) ORDER BY rs.sort_order)
          FROM public.v_bom_routing_cost rs
          JOIN bom_qty bq ON bq.bom_header_id = rs.bom_header_id
          WHERE rs.bom_header_id = s.bom_header_id
        ), '[]'::jsonb),
        'rm_subtotal', round(COALESCE(srt.rm_total, 0), 6),
        'labour_subtotal', round(COALESCE(slt.labour_total, 0), 6),
        'subtotal', round(COALESCE(srt.rm_total, 0) + COALESCE(slt.labour_total, 0), 6)
      ) ORDER BY s.stage_depth)
      FROM stage_owners s
      JOIN public.items ni ON ni.id = s.owner_item_id
      LEFT JOIN stage_rm_total srt ON srt.stage_owner_id = s.owner_item_id
      LEFT JOIN stage_labour_total slt ON slt.bom_header_id = s.bom_header_id
    ), '[]'::jsonb),
    'overhead', CASE WHEN oh.rate_per_kg IS NULL THEN NULL ELSE
      jsonb_build_object('rate_per_kg', oh.rate_per_kg, 'effective_from', oh.effective_from,
                         'source', oh.source, 'override_reason', oh.override_reason)
    END
  ) INTO v_result
  FROM public.items i
  LEFT JOIN public.v_item_landed_cost_v3 v3 ON v3.item_id = i.id
  LEFT JOIN public.v_overhead_standard_current oh
         ON oh.tenant_id = i.tenant_id
        -- Loosened: OH joins for anything we produce (has active BOM) OR
        -- standard producible types. Mig 135 — Tino May 2026.
        AND (
          EXISTS (SELECT 1 FROM public.bom_headers bh WHERE bh.item_id = i.id AND bh.is_active = true)
          OR i.item_type IN ('finished_good','wip','wipf','wipp')
        )
  WHERE i.id = p_item_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cost_breakdown_v2(uuid) TO authenticated;
