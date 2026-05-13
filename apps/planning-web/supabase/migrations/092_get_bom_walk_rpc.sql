-- ============================================================================
-- 092  get_bom_walk(p_item_id) RPC
-- ----------------------------------------------------------------------------
-- Returns every item, BOM header, and BOM line reachable via the BOM tree
-- starting at p_item_id, as a single jsonb blob. Used by draftProductSpec to
-- auto-pop a product spec without depending on PostgREST's row-cap behaviour
-- when "fetch all tenant items" goes through the REST API.
--
-- Why not "just .limit() the items table":
--   • PostgREST applies a server-side max-rows in addition to the client's
--     .limit(); without explicit Prefer headers the cap can hide rows even
--     when client says limit=100000.
--   • Even when it works, fetching the entire tenant's items (1k+ rows with
--     20 columns) just to walk one product's BOM is wasteful.
--
-- This RPC walks the BOM graph in SQL — recursive CTE seeded with p_item_id,
-- expanding via bom_lines.component_item_id from any active bom_header for
-- visited items. Returns the closure of items + relevant bom_headers + lines.
--
-- SECURITY INVOKER → tenant RLS still applies → only the caller's tenant.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_bom_walk(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_item_ids uuid[];
  v_result jsonb;
BEGIN
  -- 1. Walk DOWN the BOM tree from p_item_id, collecting every distinct
  --    item_id reachable via bom_lines.component_item_id from any active
  --    bom_header. Cap at 12 levels (matches the JS-side cycle guard).
  WITH RECURSIVE walk(item_id, depth) AS (
    SELECT p_item_id, 0
    UNION
    SELECT bl.component_item_id, w.depth + 1
    FROM   walk w
    JOIN   public.bom_headers bh
           ON  bh.item_id   = w.item_id
           AND bh.is_active = true
    JOIN   public.bom_lines  bl
           ON  bl.bom_header_id = bh.id
    WHERE  w.depth < 12
  )
  SELECT array_agg(DISTINCT item_id)
  INTO   v_item_ids
  FROM   walk;

  -- 2. Build the result blob: items + bom_headers + bom_lines, all scoped to
  --    the reachable item set. Done in a single SELECT for one round trip.
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(to_jsonb(i.*))
      FROM (
        SELECT
          id, code, name, unit, item_type, consumed_in_weight, allergens,
          is_rte, spec_storage_temp, spec_shelf_life,
          target_weight_g, fill_weight_g, units_per_inner, units_per_outer,
          weight_mode, parent_item_id, ingredients_statement,
          nut_energy_kj, nut_energy_kcal, nut_protein_g, nut_fat_total_g,
          nut_fat_saturated_g, nut_fat_trans_g, nut_carbs_total_g,
          nut_carbs_sugars_g, nut_fibre_g, nut_sodium_mg
        FROM public.items
        WHERE id = ANY(v_item_ids)
      ) i
    ), '[]'::jsonb),
    'bom_headers', COALESCE((
      SELECT jsonb_agg(to_jsonb(h.*))
      FROM (
        SELECT id, item_id, reference_batch_size, reference_batch_unit,
               yield_factor, is_active
        FROM public.bom_headers
        WHERE item_id = ANY(v_item_ids)
          AND is_active = true
      ) h
    ), '[]'::jsonb),
    'bom_lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(l.*))
      FROM (
        SELECT bl.bom_header_id, bl.component_item_id, bl.qty_per_batch,
               bl.unit, bl.percentage, bl.basis
        FROM public.bom_lines bl
        JOIN public.bom_headers bh
          ON bh.id = bl.bom_header_id
        WHERE bh.item_id = ANY(v_item_ids)
          AND bh.is_active = true
      ) l
    ), '[]'::jsonb),
    'reached_count', COALESCE(array_length(v_item_ids, 1), 0)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_bom_walk(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_bom_walk(uuid) IS
  'Returns the closure of items + active bom_headers + bom_lines reachable via the BOM tree from the given item id, as a single jsonb blob. Used by the spec auto-pop engine to avoid PostgREST row-cap edge cases on whole-tenant items fetches.';
