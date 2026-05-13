-- ============================================================================
-- Migration 131 — cost_breakdown_v2 (per-BOM stages + cost centres)
--
-- v1 returned flat lists of RM lines (all leaves) and labour lines (all
-- routing steps across the cascade tree). v2 groups them by the BOM that
-- owns them, so the audit page can render a vertical 'cost sheet':
--
--   Stage 1 (FG):   direct RM + labour at FG level  → subtotal
--   Stage 2 (WIPP): direct RM + labour at WIPP level → subtotal
--   Stage 3 (WIPF): direct RM + labour at WIPF level → subtotal
--   Stage 4 (WIP):  direct RM + labour at WIP level  → subtotal
--   Total = sum of stages + Overhead at root
--
-- "Direct RM" = leaves that are CHILDREN of this stage's BOM (not
-- descendants two levels down). Implemented by carrying parent_node_id
-- through the recursive CTE and grouping leaves by their direct parent.
-- A leaf used by two stages (e.g. salt in WIPF AND WIPP) appears in
-- both stages with the appropriate qty share.
--
-- Plus a "cost_centres" array: dept-level rollup of labour ($/kg by
-- department) for the donut/stacked-bar at the top of the audit page.
-- ============================================================================

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
    SELECT
      i.id              AS root_id,
      i.id              AS node_id,
      NULL::uuid        AS parent_node_id,
      1.0::numeric      AS qty_at_node,
      0                 AS depth,
      ARRAY[i.id]::uuid[] AS path,
      i.target_weight_g  AS inh_target_weight_g,
      i.units_per_inner  AS inh_units_per_inner,
      i.units_per_outer  AS inh_units_per_outer,
      i.units_per_pallet AS inh_units_per_pallet
    FROM public.items i
    WHERE i.id = p_item_id

    UNION ALL

    SELECT
      e.root_id,
      bl.component_item_id,
      e.node_id  AS parent_node_id,
      CASE
        WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN
          (e.qty_at_node / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
            * (bl.percentage / 100.0)
        WHEN bl.unit = 'kg' THEN
          (e.qty_at_node / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
            * (bl.qty_per_batch / NULLIF((
                SELECT SUM(bl2.qty_per_batch)
                FROM public.bom_lines bl2
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
      COALESCE(child.target_weight_g,  e.inh_target_weight_g),
      COALESCE(child.units_per_inner,  e.inh_units_per_inner),
      COALESCE(child.units_per_outer,  e.inh_units_per_outer),
      COALESCE(child.units_per_pallet, e.inh_units_per_pallet)
    FROM       explode e
    JOIN       public.bom_headers bh    ON bh.item_id = e.node_id AND bh.is_active = true
    JOIN       public.bom_lines   bl    ON bl.bom_header_id = bh.id
    JOIN       public.items       child ON child.id = bl.component_item_id
    WHERE e.depth < 12 AND NOT (bl.component_item_id = ANY(e.path))
  ),
  -- Every BOM the cascade touches (one per stage).
  stage_owners AS (
    SELECT DISTINCT
      e.node_id          AS owner_item_id,
      bh.id              AS bom_header_id,
      MIN(e.depth) OVER (PARTITION BY e.node_id) AS stage_depth
    FROM explode e
    JOIN public.bom_headers bh ON bh.item_id = e.node_id AND bh.is_active = true
  ),
  -- Each leaf grouped by its DIRECT parent (not the root). Salt used in
  -- both WIPF and WIPP shows up twice with different qty shares.
  leaf_at_parent AS (
    SELECT
      e.parent_node_id   AS stage_owner_id,
      e.node_id          AS leaf_id,
      SUM(COALESCE(e.qty_at_node, 0))   AS qty,
      bool_or(e.qty_at_node IS NULL)    AS hierarchy_missing
    FROM explode e
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bom_headers bh
      WHERE  bh.item_id = e.node_id AND bh.is_active = true
    )
    AND e.parent_node_id IS NOT NULL  -- skip the root anchor row
    GROUP BY e.parent_node_id, e.node_id
  ),
  -- Per BOM in the cascade: total qty_at_node (for labour cascade math).
  bom_qty AS (
    SELECT
      bh.id                            AS bom_header_id,
      SUM(COALESCE(e.qty_at_node, 0))  AS qty_at_node
    FROM explode e
    JOIN public.bom_headers bh ON bh.item_id = e.node_id AND bh.is_active = true
    GROUP BY bh.id
  ),
  -- Per BOM totals so we can compute stage subtotal + cost-centre breakdown.
  stage_labour AS (
    SELECT
      rs.bom_header_id,
      rs.department_name,
      SUM(bq.qty_at_node * COALESCE(rs.dollars_per_kg, 0)) AS dept_total
    FROM public.v_bom_routing_cost rs
    JOIN bom_qty bq ON bq.bom_header_id = rs.bom_header_id
    GROUP BY rs.bom_header_id, rs.department_name
  ),
  stage_rm_total AS (
    SELECT
      lp.stage_owner_id,
      SUM(lp.qty * COALESCE(ich.effective_cost, 0)) AS rm_total
    FROM leaf_at_parent lp
    LEFT JOIN public.v_item_cost_health ich ON ich.item_id = lp.leaf_id
    GROUP BY lp.stage_owner_id
  ),
  stage_labour_total AS (
    SELECT bom_header_id, SUM(dept_total) AS labour_total
    FROM stage_labour
    GROUP BY bom_header_id
  ),
  -- Cost-centre rollup: sum labour by department across every stage.
  cost_centres AS (
    SELECT
      department_name AS centre,
      SUM(dept_total) AS amount
    FROM stage_labour
    GROUP BY department_name
  )
  SELECT jsonb_build_object(
    'item', jsonb_build_object(
      'id',        i.id,
      'code',      i.code,
      'name',      i.name,
      'item_type', i.item_type,
      'unit',      i.unit
    ),
    'totals', jsonb_build_object(
      'rm',       COALESCE(v3.rm_cost_per_unit,      0),
      'labour',   COALESCE(v3.labour_cost_per_unit,  0),
      'overhead', COALESCE(v3.overhead_cost_per_unit,0),
      'total',    COALESCE(v3.total_cost_per_unit,   0)
    ),
    'cost_centres', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'centre', centre,
        'amount', round(amount, 6)
      ) ORDER BY amount DESC)
      FROM cost_centres
      WHERE amount > 0
    ), '[]'::jsonb),
    'stages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'bom_header_id', s.bom_header_id,
        'node_id',       s.owner_item_id,
        'node_code',     ni.code,
        'node_name',     ni.name,
        'node_type',     ni.item_type,
        'depth',         s.stage_depth,
        'rm_lines',      COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'item_id',           lp.leaf_id,
            'code',              li.code,
            'name',              li.name,
            'item_type',         li.item_type,
            'unit',              li.unit,
            'qty_per_unit',      round(lp.qty, 6),
            'unit_cost',         round(COALESCE(ich.effective_cost, 0), 4),
            'line_cost',         round(lp.qty * COALESCE(ich.effective_cost, 0), 4),
            'supplier_name',     sup.name,
            'hierarchy_missing', lp.hierarchy_missing
          ) ORDER BY (lp.qty * COALESCE(ich.effective_cost, 0)) DESC, li.code)
          FROM leaf_at_parent lp
          JOIN public.items li ON li.id = lp.leaf_id
          LEFT JOIN public.v_item_cost_health ich ON ich.item_id = lp.leaf_id
          LEFT JOIN public.suppliers sup ON sup.id = ich.cheapest_supplier_id
          WHERE lp.stage_owner_id = s.owner_item_id
        ), '[]'::jsonb),
        'labour_lines',  COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'department',             rs.department_name,
            'step_name',              rs.step_name,
            'people',                 rs.people_count,
            'minutes',                rs.std_minutes,
            'ref_qty',                rs.reference_qty,
            'ref_basis',              rs.reference_basis,
            'dollars_per_kg_at_node', round(COALESCE(rs.dollars_per_kg, 0), 6),
            'qty_at_node',            round(bq.qty_at_node, 6),
            'contribution_per_unit',  round(bq.qty_at_node * COALESCE(rs.dollars_per_kg, 0), 6),
            'hierarchy_missing',      rs.hierarchy_missing
          ) ORDER BY rs.sort_order)
          FROM public.v_bom_routing_cost rs
          JOIN bom_qty bq ON bq.bom_header_id = rs.bom_header_id
          WHERE rs.bom_header_id = s.bom_header_id
        ), '[]'::jsonb),
        'rm_subtotal',     round(COALESCE(srt.rm_total, 0), 6),
        'labour_subtotal', round(COALESCE(slt.labour_total, 0), 6),
        'subtotal',        round(COALESCE(srt.rm_total, 0) + COALESCE(slt.labour_total, 0), 6)
      ) ORDER BY s.stage_depth)
      FROM stage_owners s
      JOIN public.items ni ON ni.id = s.owner_item_id
      LEFT JOIN stage_rm_total      srt ON srt.stage_owner_id = s.owner_item_id
      LEFT JOIN stage_labour_total  slt ON slt.bom_header_id  = s.bom_header_id
    ), '[]'::jsonb),
    'overhead', CASE WHEN oh.rate_per_kg IS NULL THEN NULL ELSE
      jsonb_build_object(
        'rate_per_kg',     oh.rate_per_kg,
        'effective_from',  oh.effective_from,
        'source',          oh.source,
        'override_reason', oh.override_reason
      )
    END
  )
  INTO v_result
  FROM public.items i
  LEFT JOIN public.v_item_landed_cost_v3 v3 ON v3.item_id = i.id
  LEFT JOIN public.v_overhead_standard_current oh
         ON oh.tenant_id = i.tenant_id
        AND i.item_type IN ('finished_good','wip','wipf','wipp')
  WHERE i.id = p_item_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cost_breakdown_v2(uuid) TO authenticated;

COMMENT ON FUNCTION public.cost_breakdown_v2(uuid) IS
  'Per-1-unit cost breakdown grouped by BOM stage (FG → WIPP → WIPF → WIP). '
  'Each stage carries its DIRECT RM (leaves whose parent in the cascade is '
  'this stage) and its labour (routing steps on this BOM). Includes a '
  'cost_centres array (labour by department) for the breakdown page chip bar.';
