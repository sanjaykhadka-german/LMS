-- ============================================================================
-- Migration 133 — Per-item loss percentages
--
-- Five loss categories that vary by product, layered on top of COGS in
-- the pricing buildup. Each is nullable on items; tenant pricing_buffers
-- carries the same set as defaults for items that aren't audited yet.
-- Priority on the breakdown page: item value (if not null) > tenant default.
--
-- Categories:
--   production_loss_pct — machine waste, staff drops, spillage
--   cooking_loss_pct    — additional safety buffer on top of BOM yield_factor
--                          (yield_factor already drives the cascade math;
--                          this is the extra pricing pad for cook variability)
--   packing_loss_pct    — breakage / damage at packing
--   open_pack_pct       — samples, opened-and-rejected packs
--   giveaway_pct        — average overfill above label weight on fixed-weight
--
-- All percentages stored as 0-99.99 (no fractions of basis points needed).
--
-- pricing_buffers gets 4 new columns (cooking, packing, open_pack, giveaway)
-- so the tenant fallback is complete. production_loss_pct already there.
-- ============================================================================

-- ─── Items: 5 nullable loss columns ─────────────────────────────────
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS production_loss_pct numeric
    CHECK (production_loss_pct IS NULL OR (production_loss_pct >= 0 AND production_loss_pct < 100)),
  ADD COLUMN IF NOT EXISTS cooking_loss_pct    numeric
    CHECK (cooking_loss_pct    IS NULL OR (cooking_loss_pct    >= 0 AND cooking_loss_pct    < 100)),
  ADD COLUMN IF NOT EXISTS packing_loss_pct    numeric
    CHECK (packing_loss_pct    IS NULL OR (packing_loss_pct    >= 0 AND packing_loss_pct    < 100)),
  ADD COLUMN IF NOT EXISTS open_pack_pct       numeric
    CHECK (open_pack_pct       IS NULL OR (open_pack_pct       >= 0 AND open_pack_pct       < 100)),
  ADD COLUMN IF NOT EXISTS giveaway_pct        numeric
    CHECK (giveaway_pct        IS NULL OR (giveaway_pct        >= 0 AND giveaway_pct        < 100));

COMMENT ON COLUMN items.production_loss_pct IS 'Machine waste / drops / spillage as % of COGS. NULL = use tenant default.';
COMMENT ON COLUMN items.cooking_loss_pct    IS 'Pricing buffer on TOP of BOM yield_factor. The cascade already accounts for yield-captured cook shrink; this is the extra safety pad.';
COMMENT ON COLUMN items.packing_loss_pct    IS 'Breakage / damage at packing as % of COGS. NULL = use tenant default.';
COMMENT ON COLUMN items.open_pack_pct       IS 'Samples / opened-and-rejected packs as % of COGS. NULL = use tenant default.';
COMMENT ON COLUMN items.giveaway_pct        IS 'Average overfill above label weight for fixed-weight FGs as % of COGS. NULL = use tenant default.';


-- ─── pricing_buffers: 4 new tenant default columns ───────────────────
ALTER TABLE pricing_buffers
  ADD COLUMN IF NOT EXISTS cooking_loss_pct  numeric NOT NULL DEFAULT 0 CHECK (cooking_loss_pct  >= 0 AND cooking_loss_pct  < 100),
  ADD COLUMN IF NOT EXISTS packing_loss_pct  numeric NOT NULL DEFAULT 0 CHECK (packing_loss_pct  >= 0 AND packing_loss_pct  < 100),
  ADD COLUMN IF NOT EXISTS open_pack_pct     numeric NOT NULL DEFAULT 0 CHECK (open_pack_pct     >= 0 AND open_pack_pct     < 100),
  ADD COLUMN IF NOT EXISTS giveaway_pct      numeric NOT NULL DEFAULT 0 CHECK (giveaway_pct      >= 0 AND giveaway_pct      < 100);

COMMENT ON COLUMN pricing_buffers.cooking_loss_pct IS 'Tenant default cooking-buffer % (used when items.cooking_loss_pct is NULL).';
COMMENT ON COLUMN pricing_buffers.packing_loss_pct IS 'Tenant default packing-loss % (used when items.packing_loss_pct is NULL).';
COMMENT ON COLUMN pricing_buffers.open_pack_pct    IS 'Tenant default open-pack % (used when items.open_pack_pct is NULL).';
COMMENT ON COLUMN pricing_buffers.giveaway_pct     IS 'Tenant default giveaway % (used when items.giveaway_pct is NULL).';


-- ─── v_pricing_buffers_current: republish to include the 4 new cols ──
DROP VIEW IF EXISTS v_pricing_buffers_current;
CREATE VIEW v_pricing_buffers_current AS
SELECT DISTINCT ON (tenant_id)
  id, tenant_id, effective_from,
  production_loss_pct, cooking_loss_pct, packing_loss_pct, open_pack_pct, giveaway_pct,
  depreciation_pct, sample_pct, product_dev_pct, error_pct, target_margin_pct,
  notes, created_by, created_at
FROM pricing_buffers
WHERE effective_from <= CURRENT_DATE
ORDER BY tenant_id, effective_from DESC;
GRANT SELECT ON v_pricing_buffers_current TO authenticated;


-- ─── cost_breakdown_v2: surface item losses in the response ──────────
-- Same body as mig 131, just the 'item' jsonb now includes the loss fields
-- so the breakdown page can compute item-aware pricing without an extra query.
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
      e.node_id,
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
      END,
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
  stage_owners AS (
    SELECT DISTINCT
      e.node_id          AS owner_item_id,
      bh.id              AS bom_header_id,
      MIN(e.depth) OVER (PARTITION BY e.node_id) AS stage_depth
    FROM explode e
    JOIN public.bom_headers bh ON bh.item_id = e.node_id AND bh.is_active = true
  ),
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
    AND e.parent_node_id IS NOT NULL
    GROUP BY e.parent_node_id, e.node_id
  ),
  bom_qty AS (
    SELECT
      bh.id                            AS bom_header_id,
      SUM(COALESCE(e.qty_at_node, 0))  AS qty_at_node
    FROM explode e
    JOIN public.bom_headers bh ON bh.item_id = e.node_id AND bh.is_active = true
    GROUP BY bh.id
  ),
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
  cost_centres AS (
    SELECT
      department_name AS centre,
      SUM(dept_total) AS amount
    FROM stage_labour
    GROUP BY department_name
  )
  SELECT jsonb_build_object(
    'item', jsonb_build_object(
      'id',                  i.id,
      'code',                i.code,
      'name',                i.name,
      'item_type',           i.item_type,
      'unit',                i.unit,
      'production_loss_pct', i.production_loss_pct,
      'cooking_loss_pct',    i.cooking_loss_pct,
      'packing_loss_pct',    i.packing_loss_pct,
      'open_pack_pct',       i.open_pack_pct,
      'giveaway_pct',        i.giveaway_pct
    ),
    'totals', jsonb_build_object(
      'rm',       COALESCE(v3.rm_cost_per_unit,      0),
      'labour',   COALESCE(v3.labour_cost_per_unit,  0),
      'overhead', COALESCE(v3.overhead_cost_per_unit,0),
      'total',    COALESCE(v3.total_cost_per_unit,   0)
    ),
    'cost_centres', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('centre', centre, 'amount', round(amount, 6)) ORDER BY amount DESC)
      FROM cost_centres WHERE amount > 0
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
            'item_id', lp.leaf_id, 'code', li.code, 'name', li.name,
            'item_type', li.item_type, 'unit', li.unit,
            'qty_per_unit', round(lp.qty, 6),
            'unit_cost', round(COALESCE(ich.effective_cost, 0), 4),
            'line_cost', round(lp.qty * COALESCE(ich.effective_cost, 0), 4),
            'supplier_name', sup.name,
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
        'rm_subtotal',     round(COALESCE(srt.rm_total, 0), 6),
        'labour_subtotal', round(COALESCE(slt.labour_total, 0), 6),
        'subtotal',        round(COALESCE(srt.rm_total, 0) + COALESCE(slt.labour_total, 0), 6)
      ) ORDER BY s.stage_depth)
      FROM stage_owners s
      JOIN public.items ni ON ni.id = s.owner_item_id
      LEFT JOIN stage_rm_total     srt ON srt.stage_owner_id = s.owner_item_id
      LEFT JOIN stage_labour_total slt ON slt.bom_header_id  = s.bom_header_id
    ), '[]'::jsonb),
    'overhead', CASE WHEN oh.rate_per_kg IS NULL THEN NULL ELSE
      jsonb_build_object(
        'rate_per_kg', oh.rate_per_kg, 'effective_from', oh.effective_from,
        'source', oh.source, 'override_reason', oh.override_reason)
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
