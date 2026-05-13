-- ============================================================================
-- Migration 130 — cost_breakdown_v1 RPC
--
-- Returns the per-1-unit landed cost breakdown for one item as JSONB:
--
--   {
--     item:    { id, code, name, item_type, unit },
--     totals:  { rm, labour, overhead, total },          (matches v_item_landed_cost_v3)
--     rm_lines:     [ { item_id, code, name, unit,
--                       qty_per_unit, unit_cost, line_cost,
--                       supplier_name, hierarchy_missing } ],
--     labour_lines: [ { bom_header_id, node_code, node_name, node_type,
--                       department, step_name,
--                       people, minutes, ref_qty, ref_basis,
--                       dollars_per_kg_at_node, qty_at_node,
--                       contribution_per_unit, hierarchy_missing } ],
--     overhead: { rate_per_kg, effective_from, source, override_reason }
--                | NULL if no standard rate set
--   }
--
-- Used by /costings/[item_id] to render a line-by-line audit page —
-- "every position of the $/kg, in order, with math made visible".
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cost_breakdown_v1(p_item_id uuid)
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
  -- Per leaf component: sum qty across all paths.
  leaf_agg AS (
    SELECT
      e.node_id,
      SUM(COALESCE(e.qty_at_node, 0))     AS qty,
      bool_or(e.qty_at_node IS NULL)      AS hierarchy_missing
    FROM explode e
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bom_headers bh
      WHERE  bh.item_id = e.node_id AND bh.is_active = true
    )
    GROUP BY e.node_id
  ),
  -- Per BOM in the explosion: total qty_at_node (for labour cascade).
  bom_qty AS (
    SELECT
      bh.id              AS bom_header_id,
      MIN(e.depth)       AS min_depth,
      SUM(COALESCE(e.qty_at_node, 0)) AS qty_at_node
    FROM explode e
    JOIN public.bom_headers bh ON bh.item_id = e.node_id AND bh.is_active = true
    GROUP BY bh.id
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
    'rm_lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'item_id',           la.node_id,
        'code',              ci.code,
        'name',              ci.name,
        'item_type',         ci.item_type,
        'unit',              ci.unit,
        'qty_per_unit',      round(la.qty, 6),
        'unit_cost',         round(COALESCE(ich.effective_cost, 0), 4),
        'line_cost',         round(la.qty * COALESCE(ich.effective_cost, 0), 4),
        'supplier_name',     s.name,
        'hierarchy_missing', la.hierarchy_missing
      ) ORDER BY (la.qty * COALESCE(ich.effective_cost, 0)) DESC, ci.code)
      FROM leaf_agg la
      JOIN public.items ci ON ci.id = la.node_id
      LEFT JOIN public.v_item_cost_health ich ON ich.item_id = la.node_id
      LEFT JOIN public.suppliers s ON s.id = ich.cheapest_supplier_id
    ), '[]'::jsonb),
    'labour_lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'bom_header_id',          rs.bom_header_id,
        'node_code',              ni.code,
        'node_name',              ni.name,
        'node_type',              ni.item_type,
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
      ) ORDER BY bq.min_depth, ni.code, rs.sort_order)
      FROM public.v_bom_routing_cost rs
      JOIN bom_qty bq ON bq.bom_header_id = rs.bom_header_id
      JOIN public.bom_headers bh ON bh.id = rs.bom_header_id
      JOIN public.items ni ON ni.id = bh.item_id
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

GRANT EXECUTE ON FUNCTION public.cost_breakdown_v1(uuid) TO authenticated;

COMMENT ON FUNCTION public.cost_breakdown_v1(uuid) IS
  'Per-1-unit cost breakdown for one item. RM lines (per leaf), labour lines '
  '(per routing step on every BOM in the cascade), overhead (root-level rate). '
  'Powers /costings/[item_id] audit page.';
