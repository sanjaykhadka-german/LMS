-- Phase-1 costing: recursive view that computes RM landed cost per unit for
-- every item. For raw materials / packaging / consumables it's just
-- v_item_cost_health.effective_cost. For WIP / FG it recursively explodes
-- the BOM down to leaves and sums (factor × leaf effective_cost).
--
-- v1.1: handles `percentage` lines (canonical post mig 108) and `unit = kg`
-- lines (legacy but still common). Non-kg packaging lines (basis = per_piece
-- / per_inner / per_outer / per_pallet / per_kg) are SKIPPED in v1 — they
-- need items.target_weight_g + units_per_inner/outer/pallet to compute
-- correctly. That's deferred to v2. Today the RM cost number reflects
-- ingredients accurately; packaging contribution is missing but visible via
-- leaves_missing_cost.
--
-- Output columns:
--   item_id, code, name, item_type, unit
--   manual_standard_cost   — items.standard_cost (manual override)
--   rm_cost_per_unit       — cascaded cost per 1 unit
--   component_count        — distinct leaf components in the cascade
--   leaves_missing_cost    — count of leaves with no supplier price (RED FLAG)
--   has_active_bom         — true if the item has an is_active BOM
--   variance_pct           — (cascade − manual) / manual × 100, NULL if no manual

DROP VIEW IF EXISTS v_item_landed_cost_v1;

CREATE OR REPLACE VIEW v_item_landed_cost_v1 AS
WITH RECURSIVE explode AS (
  -- Anchor: every item is its own root, qty 1.
  SELECT
    i.id            AS root_id,
    i.id            AS node_id,
    1.0::numeric    AS qty_at_node,
    0               AS depth,
    ARRAY[i.id]::uuid[] AS path
  FROM items i

  UNION ALL

  -- Recurse: for each node with an active BOM, expand its children. Skip
  -- non-kg / non-percentage lines (packaging) — they need basis-aware math
  -- handled in v2.
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
      ELSE NULL
    END AS qty_at_node,
    e.depth + 1,
    e.path || bl.component_item_id
  FROM explode e
  JOIN bom_headers bh ON bh.item_id = e.node_id AND bh.is_active = true
  JOIN bom_lines   bl ON bl.bom_header_id = bh.id
  WHERE e.depth < 12
    AND NOT (bl.component_item_id = ANY(e.path))
    AND ((bl.percentage IS NOT NULL AND bl.percentage > 0) OR bl.unit = 'kg')
),
leaves AS (
  SELECT e.root_id, e.node_id, e.qty_at_node
  FROM   explode e
  WHERE NOT EXISTS (
    SELECT 1 FROM bom_headers bh
    WHERE  bh.item_id = e.node_id AND bh.is_active = true
  )
  AND e.qty_at_node IS NOT NULL
),
roll_up AS (
  SELECT
    l.root_id                                            AS item_id,
    SUM(l.qty_at_node * COALESCE(ich.effective_cost, 0)) AS rm_cost_per_unit,
    COUNT(DISTINCT l.node_id)                            AS component_count,
    SUM(CASE WHEN COALESCE(ich.effective_cost, 0) > 0 THEN 0 ELSE 1 END)
                                                         AS leaves_missing_cost
  FROM leaves l
  LEFT JOIN v_item_cost_health ich ON ich.item_id = l.node_id
  GROUP BY l.root_id
)
SELECT
  i.id                                            AS item_id,
  i.code,
  i.name,
  i.item_type,
  i.unit,
  i.standard_cost                                 AS manual_standard_cost,
  COALESCE(rb.rm_cost_per_unit, 0)::numeric(14,4) AS rm_cost_per_unit,
  COALESCE(rb.component_count, 0)                 AS component_count,
  COALESCE(rb.leaves_missing_cost, 0)             AS leaves_missing_cost,
  EXISTS (
    SELECT 1 FROM bom_headers bh
    WHERE  bh.item_id = i.id AND bh.is_active = true
  )                                               AS has_active_bom,
  CASE
    WHEN i.standard_cost IS NOT NULL
     AND i.standard_cost <> 0
     AND rb.rm_cost_per_unit IS NOT NULL
    THEN ROUND(((rb.rm_cost_per_unit - i.standard_cost) / i.standard_cost) * 100, 1)
    ELSE NULL
  END                                             AS variance_pct
FROM items i
LEFT JOIN roll_up rb ON rb.item_id = i.id;

GRANT SELECT ON v_item_landed_cost_v1 TO authenticated;
