-- ============================================================================
-- 050  get_item_tree(p_item_id) RPC
-- ----------------------------------------------------------------------------
-- Returns the complete BOM hierarchy that the given item participates in:
--   ancestors (walk parent_item_id up to the root)
--   + the item itself
--   + every descendant (walk child→parent_item_id down)
--
-- Used by the Product Tree component so the rendered tree is GUARANTEED to be
-- complete regardless of how many items the tenant has, what types they are,
-- or whether intermediate joins/limits in the broad items query missed any.
--
-- SECURITY INVOKER → RLS on `items` still applies → only items in the
-- caller's tenant come back.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_item_tree(p_item_id uuid)
RETURNS TABLE (
  id                uuid,
  code              text,
  name              text,
  item_type         text,
  parent_item_id    uuid,
  category_name     text,
  subcategory_name  text
)
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE
  -- 1. Walk UP from the given item to all ancestors.
  ancestors AS (
    SELECT id, parent_item_id
    FROM public.items
    WHERE id = p_item_id
    UNION ALL
    SELECT i.id, i.parent_item_id
    FROM public.items i
    JOIN ancestors a ON a.parent_item_id = i.id
  ),
  -- 2. The topmost ancestor is the row in `ancestors` with NULL parent_item_id
  --    (or the highest one we could reach if the chain is broken — fallback to
  --    the original item if no chain exists).
  root_id AS (
    SELECT id
    FROM ancestors
    WHERE parent_item_id IS NULL
    LIMIT 1
  ),
  -- 3. Walk DOWN from the root to every descendant.
  descendants AS (
    SELECT id, parent_item_id
    FROM public.items
    WHERE id = COALESCE((SELECT id FROM root_id), p_item_id)
    UNION ALL
    SELECT i.id, i.parent_item_id
    FROM public.items i
    JOIN descendants d ON i.parent_item_id = d.id
  )
  SELECT DISTINCT
    i.id,
    i.code,
    i.name,
    i.item_type,
    i.parent_item_id,
    ic.name AS category_name,
    isub.name AS subcategory_name
  FROM public.items i
  LEFT JOIN public.item_categories    ic   ON ic.id   = i.item_category_id
  LEFT JOIN public.item_subcategories isub ON isub.id = i.item_subcategory_id
  WHERE i.id IN (
    SELECT id FROM ancestors
    UNION
    SELECT id FROM descendants
  )
  ORDER BY i.code;
$$;

GRANT EXECUTE ON FUNCTION public.get_item_tree(uuid) TO authenticated;
