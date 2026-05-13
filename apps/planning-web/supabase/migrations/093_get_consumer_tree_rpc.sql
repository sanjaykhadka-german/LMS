-- ============================================================================
-- 093  get_consumer_tree(p_item_id) RPC
-- ----------------------------------------------------------------------------
-- Mirror of get_bom_walk (mig 092) that walks UP the BOM tree instead of down.
-- Given an item, returns every item that depends on it via active BOMs —
-- direct consumers and recursively their consumers, up to depth 12.
--
-- Used by the day-cascade feature on the planner: when a parent production
-- order (e.g. the WIP / cooking stage) is dragged onto a different day, every
-- downstream order in the same demand chain auto-moves to that day as the
-- starting position. The planner can refine afterwards (push WIPF to Tue,
-- WIPP to Wed, etc.).
--
-- Why a JSONB return: keeps the API consistent with get_bom_walk and avoids
-- a second round-trip when the action wants to know not just the count but
-- which orders to update.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_consumer_tree(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_item_ids uuid[];
  v_result jsonb;
BEGIN
  -- Walk UP the BOM tree: at each step, find every item whose ACTIVE BOM
  -- header contains a line referencing the current item as a component.
  WITH RECURSIVE walk(item_id, depth) AS (
    SELECT p_item_id, 0
    UNION
    SELECT bh.item_id, w.depth + 1
    FROM   walk w
    JOIN   public.bom_lines   bl ON bl.component_item_id = w.item_id
    JOIN   public.bom_headers bh
           ON  bh.id        = bl.bom_header_id
           AND bh.is_active = true
    WHERE  w.depth < 12
  )
  SELECT array_agg(DISTINCT item_id)
  INTO   v_item_ids
  FROM   walk
  WHERE  item_id <> p_item_id;  -- exclude self; cascade only touches consumers

  SELECT jsonb_build_object(
    'consumer_item_ids', COALESCE(to_jsonb(v_item_ids), '[]'::jsonb),
    'reached_count',     COALESCE(array_length(v_item_ids, 1), 0)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_consumer_tree(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_consumer_tree(uuid) IS
  'Returns every item that consumes the given item (directly or recursively) via active BOMs, as a jsonb {consumer_item_ids: uuid[], reached_count: int}. Mirror of get_bom_walk for the upward direction. Used by the planner day-cascade.';
