-- ============================================================================
-- Migration 129 — v_item_landed_cost_v3 (Phase 2 rebuild step 4)
--
-- The cascade payoff. Same recursive explosion as v2 (basis-aware pack
-- hierarchy inheritance) — adds:
--   • Labour cost — for every node in the BOM tree that has an active BOM,
--     join v_bom_routing_cost_summary and add (qty_at_node × $/kg of node).
--     Sums up the tree: FG's Labelling step + WIPP's Filling step +
--     WIPF's Production step → one rolled-up labour $/kg of root.
--   • Overhead cost — only for producible item types (FG / WIP / WIPF / WIPP).
--     Pulls $/kg from v_overhead_standard_current. Not propagated down the
--     tree — applies once at the root so we don't double-count when WIPF
--     rolls into FG.
--
-- Output columns added vs v2:
--   labour_cost_per_unit     — total labour cascaded from routings
--   labour_hierarchy_missing — true if any step couldn't compute
--   overhead_cost_per_unit   — standard rate × 1 (or 0 for non-producibles)
--   total_cost_per_unit      — rm + labour + overhead
--
-- v1 and v2 stay in place. Frontend will switch to v3 in the next commit.
-- ============================================================================

DROP VIEW IF EXISTS v_item_landed_cost_v3;

CREATE VIEW v_item_landed_cost_v3 AS
WITH RECURSIVE explode AS (
  -- Anchor: every item is its own root, qty 1.
  SELECT
    i.id              AS root_id,
    i.id              AS node_id,
    1.0::numeric      AS qty_at_node,
    0                 AS depth,
    ARRAY[i.id]::uuid[] AS path,
    i.target_weight_g  AS inh_target_weight_g,
    i.units_per_inner  AS inh_units_per_inner,
    i.units_per_outer  AS inh_units_per_outer,
    i.units_per_pallet AS inh_units_per_pallet
  FROM items i

  UNION ALL

  SELECT
    e.root_id,
    bl.component_item_id AS node_id,
    CASE
      WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN
        (e.qty_at_node / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
          * (bl.percentage / 100.0)
      WHEN bl.unit = 'kg' THEN
        (e.qty_at_node / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
          * (bl.qty_per_batch / NULLIF((
              SELECT SUM(bl2.qty_per_batch)
              FROM bom_lines bl2
              WHERE bl2.bom_header_id = bh.id AND bl2.unit = 'kg'
            ), 0))
      WHEN bl.basis = 'per_kg' THEN
        e.qty_at_node * bl.qty_per_batch
      WHEN bl.basis = 'per_piece' AND e.inh_target_weight_g > 0 THEN
        (e.qty_at_node * 1000.0 / e.inh_target_weight_g) * bl.qty_per_batch
      WHEN bl.basis = 'per_inner'
           AND e.inh_target_weight_g > 0 AND e.inh_units_per_inner > 0 THEN
        (e.qty_at_node * 1000.0 / e.inh_target_weight_g / e.inh_units_per_inner)
          * bl.qty_per_batch
      WHEN bl.basis = 'per_outer'
           AND e.inh_target_weight_g > 0 AND e.inh_units_per_outer > 0 THEN
        (e.qty_at_node * 1000.0 / e.inh_target_weight_g / e.inh_units_per_outer)
          * bl.qty_per_batch
      WHEN bl.basis = 'per_pallet'
           AND e.inh_target_weight_g > 0 AND e.inh_units_per_pallet > 0 THEN
        (e.qty_at_node * 1000.0 / e.inh_target_weight_g / e.inh_units_per_pallet)
          * bl.qty_per_batch
      ELSE NULL
    END AS qty_at_node,
    e.depth + 1,
    e.path || bl.component_item_id,
    COALESCE(child.target_weight_g,  e.inh_target_weight_g)  AS inh_target_weight_g,
    COALESCE(child.units_per_inner,  e.inh_units_per_inner)  AS inh_units_per_inner,
    COALESCE(child.units_per_outer,  e.inh_units_per_outer)  AS inh_units_per_outer,
    COALESCE(child.units_per_pallet, e.inh_units_per_pallet) AS inh_units_per_pallet
  FROM       explode    e
  JOIN       bom_headers bh    ON bh.item_id = e.node_id AND bh.is_active = true
  JOIN       bom_lines   bl    ON bl.bom_header_id = bh.id
  JOIN       items       child ON child.id = bl.component_item_id
  WHERE e.depth < 12
    AND NOT (bl.component_item_id = ANY(e.path))
),
-- RM rollup — leaves only (items without an active BOM)
rm_rollup AS (
  SELECT
    e.root_id                                                AS item_id,
    SUM(COALESCE(e.qty_at_node, 0) * COALESCE(ich.effective_cost, 0))
                                                             AS rm_cost_per_unit,
    COUNT(DISTINCT e.node_id)                                AS component_count,
    SUM(CASE WHEN COALESCE(ich.effective_cost, 0) > 0 THEN 0 ELSE 1 END)
                                                             AS leaves_missing_cost,
    SUM(CASE WHEN e.qty_at_node IS NULL THEN 1 ELSE 0 END)   AS leaves_missing_hierarchy
  FROM explode e
  LEFT JOIN v_item_cost_health ich ON ich.item_id = e.node_id
  WHERE NOT EXISTS (
    SELECT 1 FROM bom_headers bh
    WHERE  bh.item_id = e.node_id AND bh.is_active = true
  )
  GROUP BY e.root_id
),
-- Labour rollup — every node that has an active BOM + a routing summary.
-- Note: a BOM with no routings has zero rows in v_bom_routing_cost_summary,
-- so the JOIN naturally excludes them (their labour contribution is 0).
labour_rollup AS (
  SELECT
    e.root_id                                                AS item_id,
    SUM(COALESCE(e.qty_at_node, 0) * COALESCE(rs.total_labour_per_kg, 0))
                                                             AS labour_cost_per_unit,
    bool_or(rs.any_hierarchy_missing)                        AS labour_hierarchy_missing
  FROM explode e
  JOIN bom_headers bh ON bh.item_id = e.node_id AND bh.is_active = true
  JOIN v_bom_routing_cost_summary rs ON rs.bom_header_id = bh.id
  GROUP BY e.root_id
)
SELECT
  i.id                                            AS item_id,
  i.code,
  i.name,
  i.item_type,
  i.unit,
  i.standard_cost                                 AS manual_standard_cost,

  COALESCE(rm.rm_cost_per_unit, 0)::numeric(14,4) AS rm_cost_per_unit,

  COALESCE(lab.labour_cost_per_unit, 0)::numeric(14,4) AS labour_cost_per_unit,

  -- Overhead applies only to producible item types (FG / WIP / WIPF / WIPP).
  -- Plant overhead is a per-kg-of-output allocation; non-producibles aren't
  -- "produced" so they don't absorb OH.
  CASE
    WHEN i.item_type IN ('finished_good','wip','wipf','wipp')
      THEN COALESCE(oh.rate_per_kg, 0)
    ELSE 0
  END::numeric(14,4)                              AS overhead_cost_per_unit,

  (COALESCE(rm.rm_cost_per_unit, 0)
   + COALESCE(lab.labour_cost_per_unit, 0)
   + CASE WHEN i.item_type IN ('finished_good','wip','wipf','wipp')
          THEN COALESCE(oh.rate_per_kg, 0) ELSE 0 END
  )::numeric(14,4)                                AS total_cost_per_unit,

  COALESCE(rm.component_count, 0)                 AS component_count,
  COALESCE(rm.leaves_missing_cost, 0)             AS leaves_missing_cost,
  COALESCE(rm.leaves_missing_hierarchy, 0)        AS leaves_missing_hierarchy,
  COALESCE(lab.labour_hierarchy_missing, false)   AS labour_hierarchy_missing,

  EXISTS (
    SELECT 1 FROM bom_headers bh
    WHERE  bh.item_id = i.id AND bh.is_active = true
  )                                               AS has_active_bom,

  -- Variance vs manual_standard_cost computed against TOTAL (RM + Labour + OH)
  -- not just RM. Operators set standard_cost as their best guess at full cost.
  CASE
    WHEN i.standard_cost IS NOT NULL
     AND i.standard_cost <> 0
    THEN ROUND(
      (((COALESCE(rm.rm_cost_per_unit, 0)
         + COALESCE(lab.labour_cost_per_unit, 0)
         + CASE WHEN i.item_type IN ('finished_good','wip','wipf','wipp')
                THEN COALESCE(oh.rate_per_kg, 0) ELSE 0 END
        ) - i.standard_cost) / i.standard_cost) * 100, 1)
    ELSE NULL
  END                                             AS variance_pct
FROM items i
LEFT JOIN rm_rollup     rm  ON rm.item_id  = i.id
LEFT JOIN labour_rollup lab ON lab.item_id = i.id
LEFT JOIN v_overhead_standard_current oh ON oh.tenant_id = i.tenant_id;

GRANT SELECT ON v_item_landed_cost_v3 TO authenticated;

COMMENT ON VIEW v_item_landed_cost_v3 IS
  'v3 (mig 129, May 2026): full landed cost. Same recursive explode as v2, '
  'extended with: per-node labour cost (joins v_bom_routing_cost_summary) '
  'and root-level overhead (joins v_overhead_standard_current, only for '
  'producible item types). total_cost_per_unit = rm + labour + overhead. '
  'Variance compares against TOTAL, not just RM.';
