-- =====================================================================
-- 137_get_item_ancestors.sql
-- Helper RPC for the family-lineage strip on the item master.
-- Walks parent_item_id upward from a given item and returns the chain.
-- Excludes the item itself (depth 0). Capped at depth 10 as a safety rail.
-- =====================================================================

CREATE OR REPLACE FUNCTION get_item_ancestors(p_item_id UUID)
RETURNS TABLE (
  id        UUID,
  code      TEXT,
  name      TEXT,
  item_type TEXT,
  unit      TEXT,
  depth     INT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE chain AS (
    SELECT i.id, i.code, i.name, i.item_type, i.unit, i.parent_item_id, 0 AS depth
    FROM items i
    WHERE i.id = p_item_id AND i.tenant_id = my_tenant_id()
    UNION ALL
    SELECT i.id, i.code, i.name, i.item_type, i.unit, i.parent_item_id, c.depth + 1
    FROM items i
    JOIN chain c ON i.id = c.parent_item_id
    WHERE i.tenant_id = my_tenant_id() AND c.depth < 10
  )
  SELECT id, code, name, item_type, unit, depth
  FROM chain
  WHERE depth > 0
  ORDER BY depth;
$$;

GRANT EXECUTE ON FUNCTION get_item_ancestors(UUID) TO authenticated;
