-- ============================================================================
-- Migration 123 — Basis-aware cascade (Step 6 of BOM overhaul)
--
-- Adds v_item_landed_cost_v2 + test_product_cascade_v2. Both rebuild the
-- explosion CTE to PROPAGATE pack-hierarchy metadata
-- (target_weight_g, units_per_inner, units_per_outer, units_per_pallet)
-- DOWN through the cascade. Each recursive step inherits the
-- nearest-ancestor value if the current node doesn't have one set.
--
-- WHY THIS EXISTS:
-- v1 CASE branches for per_piece / per_inner / per_outer / per_pallet only
-- fire when the BOM line's OWNING ITEM (e.g. a WIPP) has the metadata set
-- directly. WIPPs almost never do — those attributes live on the FG. The
-- v1 CASE silently fell through to (qty * qty_per_batch / 1000.0),
-- producing tiny garbage numbers (e.g. 0.000 roll for "1 roll per 4000
-- inners" of a packed frankfurter — 100kg of FG → 0.000025 roll instead
-- of a sensible ~0.001 roll).
--
-- v2 cascade walks the explosion path: when computing a per_inner line
-- whose containing item doesn't have units_per_inner, it uses the
-- nearest ancestor that does (typically the FG). When no ancestor has
-- the data either, qty is NULL and the leaf surfaces in
-- leaves_missing_hierarchy — explicit warning, not silent garbage.
--
-- v1 is left in place for safety / comparison; frontend switches to v2.
-- ============================================================================


-- ─── v_item_landed_cost_v2 ──────────────────────────────────────────────
DROP VIEW IF EXISTS v_item_landed_cost_v2;

CREATE VIEW v_item_landed_cost_v2 AS
WITH RECURSIVE explode AS (
  -- Anchor: every item is its own root, qty 1. inh_* carry the
  -- pack-hierarchy seen so far on the path. For the root, that's just
  -- the root's own values (NULL if unset).
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

  -- Recurse: for each node with an active BOM, expand its children. Use
  -- the parent's INHERITED metadata for per_inner/outer/pallet conversions
  -- (so a WIPP→film line picks up the FG's units_per_inner). Then update
  -- the new row's inh_* to "child's own > inherited from parent".
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
      -- Explicit: missing pack hierarchy → unable to compute. Surface as
      -- NULL rather than the v1 silent /1000 fallback.
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
leaves AS (
  -- Leaves = items with no active BOM. Keep NULL-qty leaves so they can
  -- be counted in leaves_missing_hierarchy (the explicit warning).
  SELECT
    e.root_id,
    e.node_id,
    e.qty_at_node,
    (e.qty_at_node IS NULL) AS hierarchy_missing
  FROM explode e
  WHERE NOT EXISTS (
    SELECT 1 FROM bom_headers bh
    WHERE  bh.item_id = e.node_id AND bh.is_active = true
  )
),
roll_up AS (
  SELECT
    l.root_id                                            AS item_id,
    SUM(COALESCE(l.qty_at_node, 0) * COALESCE(ich.effective_cost, 0))
                                                         AS rm_cost_per_unit,
    COUNT(DISTINCT l.node_id)                            AS component_count,
    SUM(CASE WHEN COALESCE(ich.effective_cost, 0) > 0 THEN 0 ELSE 1 END)
                                                         AS leaves_missing_cost,
    SUM(CASE WHEN l.hierarchy_missing THEN 1 ELSE 0 END) AS leaves_missing_hierarchy
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
  COALESCE(rb.leaves_missing_hierarchy, 0)        AS leaves_missing_hierarchy,
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

GRANT SELECT ON v_item_landed_cost_v2 TO authenticated;

COMMENT ON VIEW v_item_landed_cost_v2 IS
  'v2 (mig 123, May 2026): basis-aware cascade. Walks the explosion path '
  'to inherit target_weight_g + units_per_inner/outer/pallet from the '
  'nearest ancestor when the node itself doesn''t have them set. Surfaces '
  'unable-to-compute leaves via leaves_missing_hierarchy instead of '
  'silently dropping their cost.';


-- ─── test_product_cascade_v2 ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.test_product_cascade_v2(
  p_item_id  uuid,
  p_quantity numeric,
  p_uom      text DEFAULT 'units'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_item        RECORD;
  v_target_g    numeric;
  v_upi         numeric;
  v_ipo         numeric;
  v_opp         numeric;
  v_total_kg    numeric;
  v_total_units numeric;
  v_cascade     jsonb;
  v_shopping    jsonb;
  v_total_cost  numeric;
BEGIN
  SELECT i.id, i.code, i.name, i.unit, i.item_type, i.target_weight_g,
         i.units_per_inner, i.units_per_outer, i.units_per_pallet,
         i.inner_per_outer, i.outers_per_pallet, i.tenant_id
  INTO   v_item
  FROM   public.items i
  WHERE  i.id = p_item_id
    AND  i.tenant_id = my_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found in your tenant'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_target_g := COALESCE(v_item.target_weight_g, 0);
  v_upi      := GREATEST(COALESCE(v_item.units_per_inner,   1), 1);
  v_ipo      := GREATEST(COALESCE(v_item.inner_per_outer,   1), 1);
  v_opp      := GREATEST(COALESCE(v_item.outers_per_pallet, 1), 1);

  IF p_uom NOT IN ('units','kg','inner','outer','pallet') THEN
    RAISE EXCEPTION 'invalid uom %, must be one of: units, kg, inner, outer, pallet', p_uom
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_uom <> 'kg' AND v_target_g <= 0 THEN
    RAISE EXCEPTION 'item % has no target_weight_g; only kg UOM is supported for this product', v_item.code
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'quantity must be a non-negative number'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_total_kg := CASE p_uom
    WHEN 'units'  THEN p_quantity * v_target_g / 1000.0
    WHEN 'kg'     THEN p_quantity
    WHEN 'inner'  THEN p_quantity * v_upi * v_target_g / 1000.0
    WHEN 'outer'  THEN p_quantity * v_upi * v_ipo * v_target_g / 1000.0
    WHEN 'pallet' THEN p_quantity * v_upi * v_ipo * v_opp * v_target_g / 1000.0
  END;
  v_total_units := CASE WHEN v_target_g > 0 THEN v_total_kg * 1000.0 / v_target_g ELSE NULL END;

  -- Single explosion CTE — feeds both cascade rows and shopping list.
  -- inh_* propagate pack hierarchy down the tree (root's values seed it,
  -- children inherit if they don't override).
  WITH RECURSIVE explosion AS (
    SELECT v_item.id AS item_id, v_total_kg AS qty, 0 AS depth,
           v_item.code AS code, v_item.name AS name, v_item.item_type AS item_type,
           v_item.unit AS uom,
           ARRAY[v_item.code]::text[] AS path,
           v_item.target_weight_g  AS inh_target_weight_g,
           v_item.units_per_inner  AS inh_units_per_inner,
           v_item.units_per_outer  AS inh_units_per_outer,
           v_item.units_per_pallet AS inh_units_per_pallet,
           false AS hierarchy_missing
    UNION ALL
    SELECT
      bl.component_item_id,
      CASE
        WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN
          (e.qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0)) * (bl.percentage / 100.0)
        WHEN bl.unit = 'kg' THEN
          (e.qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
            * (bl.qty_per_batch / NULLIF(line_totals.recipe_sum, 0))
        WHEN bl.basis = 'per_kg' THEN
          e.qty * bl.qty_per_batch
        WHEN bl.basis = 'per_piece' AND e.inh_target_weight_g > 0 THEN
          (e.qty * 1000.0 / e.inh_target_weight_g) * bl.qty_per_batch
        WHEN bl.basis = 'per_inner'
             AND e.inh_target_weight_g > 0 AND e.inh_units_per_inner > 0 THEN
          (e.qty * 1000.0 / e.inh_target_weight_g / e.inh_units_per_inner)
            * bl.qty_per_batch
        WHEN bl.basis = 'per_outer'
             AND e.inh_target_weight_g > 0 AND e.inh_units_per_outer > 0 THEN
          (e.qty * 1000.0 / e.inh_target_weight_g / e.inh_units_per_outer)
            * bl.qty_per_batch
        WHEN bl.basis = 'per_pallet'
             AND e.inh_target_weight_g > 0 AND e.inh_units_per_pallet > 0 THEN
          (e.qty * 1000.0 / e.inh_target_weight_g / e.inh_units_per_pallet)
            * bl.qty_per_batch
        ELSE NULL
      END AS qty,
      e.depth + 1, ic.code, ic.name, ic.item_type, bl.unit, e.path || ic.code,
      COALESCE(ic.target_weight_g,  e.inh_target_weight_g)  AS inh_target_weight_g,
      COALESCE(ic.units_per_inner,  e.inh_units_per_inner)  AS inh_units_per_inner,
      COALESCE(ic.units_per_outer,  e.inh_units_per_outer)  AS inh_units_per_outer,
      COALESCE(ic.units_per_pallet, e.inh_units_per_pallet) AS inh_units_per_pallet,
      -- Mark when a non-percentage / non-kg / non-per_kg line couldn't
      -- compute because pack hierarchy is missing on every ancestor.
      CASE
        WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN false
        WHEN bl.unit = 'kg' THEN false
        WHEN bl.basis = 'per_kg' THEN false
        WHEN bl.basis IN ('per_piece','per_inner','per_outer','per_pallet')
             AND e.inh_target_weight_g IS NOT NULL AND e.inh_target_weight_g > 0
             AND (bl.basis = 'per_piece'
                  OR (bl.basis = 'per_inner'  AND e.inh_units_per_inner  > 0)
                  OR (bl.basis = 'per_outer'  AND e.inh_units_per_outer  > 0)
                  OR (bl.basis = 'per_pallet' AND e.inh_units_per_pallet > 0))
             THEN false
        ELSE true
      END AS hierarchy_missing
    FROM        explosion e
    JOIN        public.bom_headers bh ON bh.item_id = e.item_id AND bh.is_active = true
    JOIN        public.bom_lines   bl ON bl.bom_header_id = bh.id
    JOIN        public.items       ic ON ic.id = bl.component_item_id
    LEFT JOIN LATERAL (
      SELECT SUM(bl2.qty_per_batch) AS recipe_sum
      FROM   public.bom_lines bl2
      WHERE  bl2.bom_header_id = bh.id AND bl2.unit = 'kg'
    ) line_totals ON true
    WHERE e.depth < 12 AND COALESCE(e.qty, 0) > 0 AND ic.code <> ALL(e.path)
  ),
  agg AS (
    SELECT item_id,
           MAX(code) AS code, MAX(name) AS name, MAX(item_type) AS item_type,
           MAX(uom) AS uom, MAX(depth) AS depth,
           SUM(qty) AS gross_qty,
           bool_or(hierarchy_missing) AS any_hierarchy_missing
    FROM explosion GROUP BY item_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'stage_name', a.code, 'stage_label', a.name,
    'department', COALESCE(NULLIF(i.department, ''), i.item_type::text),
    'item_type', a.item_type, 'depth', a.depth,
    'required_qty', round(a.gross_qty, 4), 'unit', a.uom
  ) ORDER BY a.depth, a.code)
  INTO v_cascade
  FROM agg a
  JOIN public.items i ON i.id = a.item_id
  WHERE a.item_type IN ('finished_good','wip','wipf','wipp');

  -- Shopping list (leaves: raw_material, packaging, consumable). Carries
  -- hierarchy_missing flag so the UI can warn on uncomputable lines.
  WITH RECURSIVE explosion AS (
    SELECT v_item.id AS item_id, v_total_kg AS qty, 0 AS depth,
           v_item.code AS code, v_item.name AS name, v_item.item_type AS item_type,
           v_item.unit AS uom,
           ARRAY[v_item.code]::text[] AS path,
           v_item.target_weight_g  AS inh_target_weight_g,
           v_item.units_per_inner  AS inh_units_per_inner,
           v_item.units_per_outer  AS inh_units_per_outer,
           v_item.units_per_pallet AS inh_units_per_pallet,
           false AS hierarchy_missing
    UNION ALL
    SELECT
      bl.component_item_id,
      CASE
        WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN
          (e.qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0)) * (bl.percentage / 100.0)
        WHEN bl.unit = 'kg' THEN
          (e.qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
            * (bl.qty_per_batch / NULLIF(lt.recipe_sum, 0))
        WHEN bl.basis = 'per_kg' THEN
          e.qty * bl.qty_per_batch
        WHEN bl.basis = 'per_piece' AND e.inh_target_weight_g > 0 THEN
          (e.qty * 1000.0 / e.inh_target_weight_g) * bl.qty_per_batch
        WHEN bl.basis = 'per_inner'
             AND e.inh_target_weight_g > 0 AND e.inh_units_per_inner > 0 THEN
          (e.qty * 1000.0 / e.inh_target_weight_g / e.inh_units_per_inner)
            * bl.qty_per_batch
        WHEN bl.basis = 'per_outer'
             AND e.inh_target_weight_g > 0 AND e.inh_units_per_outer > 0 THEN
          (e.qty * 1000.0 / e.inh_target_weight_g / e.inh_units_per_outer)
            * bl.qty_per_batch
        WHEN bl.basis = 'per_pallet'
             AND e.inh_target_weight_g > 0 AND e.inh_units_per_pallet > 0 THEN
          (e.qty * 1000.0 / e.inh_target_weight_g / e.inh_units_per_pallet)
            * bl.qty_per_batch
        ELSE NULL
      END AS qty,
      e.depth + 1, ic.code, ic.name, ic.item_type, bl.unit, e.path || ic.code,
      COALESCE(ic.target_weight_g,  e.inh_target_weight_g)  AS inh_target_weight_g,
      COALESCE(ic.units_per_inner,  e.inh_units_per_inner)  AS inh_units_per_inner,
      COALESCE(ic.units_per_outer,  e.inh_units_per_outer)  AS inh_units_per_outer,
      COALESCE(ic.units_per_pallet, e.inh_units_per_pallet) AS inh_units_per_pallet,
      CASE
        WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN false
        WHEN bl.unit = 'kg' THEN false
        WHEN bl.basis = 'per_kg' THEN false
        WHEN bl.basis IN ('per_piece','per_inner','per_outer','per_pallet')
             AND e.inh_target_weight_g IS NOT NULL AND e.inh_target_weight_g > 0
             AND (bl.basis = 'per_piece'
                  OR (bl.basis = 'per_inner'  AND e.inh_units_per_inner  > 0)
                  OR (bl.basis = 'per_outer'  AND e.inh_units_per_outer  > 0)
                  OR (bl.basis = 'per_pallet' AND e.inh_units_per_pallet > 0))
             THEN false
        ELSE true
      END AS hierarchy_missing
    FROM explosion e
    JOIN public.bom_headers bh ON bh.item_id = e.item_id AND bh.is_active = true
    JOIN public.bom_lines   bl ON bl.bom_header_id = bh.id
    JOIN public.items       ic ON ic.id = bl.component_item_id
    LEFT JOIN LATERAL (
      SELECT SUM(bl2.qty_per_batch) AS recipe_sum
      FROM   public.bom_lines bl2
      WHERE  bl2.bom_header_id = bh.id AND bl2.unit = 'kg'
    ) lt ON true
    WHERE e.depth < 12 AND COALESCE(e.qty, 0) > 0 AND ic.code <> ALL(e.path)
  ),
  agg AS (
    SELECT item_id,
           MAX(code) AS code, MAX(name) AS name, MAX(item_type) AS item_type,
           MAX(uom) AS uom,
           SUM(qty) AS gross_qty,
           bool_or(hierarchy_missing) AS any_hierarchy_missing
    FROM explosion GROUP BY item_id
  )
  SELECT
    jsonb_agg(jsonb_build_object(
      'item_id', a.item_id, 'code', a.code, 'name', a.name,
      'qty', round(a.gross_qty, 4), 'unit', a.uom,
      'unit_cost',     round(COALESCE(ich.standard_cost, ich.supplier_min_price, 0), 4),
      'line_cost',     round(COALESCE(a.gross_qty, 0) * COALESCE(ich.standard_cost, ich.supplier_min_price, 0), 2),
      'supplier_id',   ich.cheapest_supplier_id,
      'supplier_name', s.name,
      'lead_time_days', si.lead_time_days,
      'hierarchy_missing', a.any_hierarchy_missing
    ) ORDER BY a.code),
    SUM(COALESCE(a.gross_qty, 0) * COALESCE(ich.standard_cost, ich.supplier_min_price, 0))
  INTO v_shopping, v_total_cost
  FROM agg a
  LEFT JOIN public.v_item_cost_health ich ON ich.item_id = a.item_id
  LEFT JOIN public.suppliers          s   ON s.id        = ich.cheapest_supplier_id
  LEFT JOIN public.supplier_items     si  ON si.item_id  = a.item_id AND si.supplier_id = ich.cheapest_supplier_id
  WHERE a.item_type IN ('raw_material','packaging','consumable');

  RETURN jsonb_build_object(
    'input', jsonb_build_object(
      'item_id', v_item.id, 'item_code', v_item.code, 'item_name', v_item.name,
      'quantity', p_quantity, 'uom', p_uom,
      'total_kg', round(v_total_kg, 4),
      'total_units', CASE WHEN v_target_g > 0 THEN round(v_total_units, 2) ELSE NULL END
    ),
    'equivalents', jsonb_build_object(
      'units',  CASE WHEN v_target_g > 0 THEN round(v_total_units, 2) ELSE NULL END,
      'kg',     round(v_total_kg, 2),
      'inner',  CASE WHEN v_target_g > 0 THEN round(v_total_units / v_upi, 2) ELSE NULL END,
      'outer',  CASE WHEN v_target_g > 0 THEN round(v_total_units / v_upi / v_ipo, 2) ELSE NULL END,
      'pallet', CASE WHEN v_target_g > 0 THEN round(v_total_units / v_upi / v_ipo / v_opp, 3) ELSE NULL END
    ),
    'cascade',       COALESCE(v_cascade,  '[]'::jsonb),
    'shopping_list', COALESCE(v_shopping, '[]'::jsonb),
    'totals', jsonb_build_object(
      'total_cost',    round(COALESCE(v_total_cost, 0), 2),
      'cost_per_unit', CASE WHEN v_total_units > 0 THEN round(COALESCE(v_total_cost, 0) / v_total_units, 4) ELSE NULL END,
      'cost_per_kg',   CASE WHEN v_total_kg    > 0 THEN round(COALESCE(v_total_cost, 0) / v_total_kg,    4) ELSE NULL END
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.test_product_cascade_v2(uuid, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.test_product_cascade_v2(uuid, numeric, text) IS
  'v2 (mig 123, May 2026): basis-aware cascade. Same shape as v1 but per_piece/per_inner/'
  'per_outer/per_pallet lines now walk up the explosion path to inherit pack hierarchy '
  '(target_weight_g + units_per_*) from the nearest ancestor that has it set. Each '
  'shopping_list row carries a hierarchy_missing flag; total_cost no longer counts those.';
