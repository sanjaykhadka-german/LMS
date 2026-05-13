-- ============================================================================
-- 068  items.sort_order + tree-grid sibling ordering
-- ----------------------------------------------------------------------------
-- The Product Tree previously fell back to ORDER BY code, which meant Tino
-- had no way to say "this child sits above that one" in the family tree —
-- the order was implicit and locked to the alphabetic code.
--
-- This migration:
--   1. adds sort_order INT (default 0) to items
--   2. seeds it for every existing row using ROW_NUMBER over (parent, code)
--      so the existing visual order doesn't shift on first load
--   3. indexes (parent_item_id, sort_order) for fast sibling lookups
--   4. extends get_item_tree() to return sort_order
--
-- Reorder operations are done from the client (direct supabase update; RLS
-- protects). Promote = set parent_item_id = grandparent's id.
-- ============================================================================

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_items_parent_sort
  ON public.items(parent_item_id, sort_order);

-- Seed sort_order for the initial state. Number siblings 0,1,2,… per parent
-- group by the legacy code-order, so the tree looks identical the first time
-- it loads after the migration. (Anyone who reorders later overwrites this.)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(parent_item_id::text, '__root__'), tenant_id
      ORDER BY code
    ) - 1 AS rn
  FROM public.items
)
UPDATE public.items i
SET sort_order = r.rn
FROM ranked r
WHERE i.id = r.id
  AND i.sort_order = 0;  -- only seed rows still on the default

-- Re-create get_item_tree with sort_order in the projection.
-- DROP first because Postgres won't let CREATE OR REPLACE change the
-- function's return-type signature.
DROP FUNCTION IF EXISTS public.get_item_tree(uuid);

CREATE FUNCTION public.get_item_tree(p_item_id uuid)
RETURNS TABLE (
  id                uuid,
  code              text,
  name              text,
  item_type         text,
  parent_item_id    uuid,
  category_name     text,
  subcategory_name  text,
  sort_order        integer
)
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE
  ancestors AS (
    SELECT id, parent_item_id
    FROM public.items
    WHERE id = p_item_id
    UNION ALL
    SELECT i.id, i.parent_item_id
    FROM public.items i
    JOIN ancestors a ON a.parent_item_id = i.id
  ),
  root_id AS (
    SELECT id
    FROM ancestors
    WHERE parent_item_id IS NULL
    LIMIT 1
  ),
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
    isub.name AS subcategory_name,
    i.sort_order
  FROM public.items i
  LEFT JOIN public.item_categories    ic   ON ic.id   = i.item_category_id
  LEFT JOIN public.item_subcategories isub ON isub.id = i.item_subcategory_id
  WHERE i.id IN (
    SELECT id FROM ancestors
    UNION
    SELECT id FROM descendants
  )
  ORDER BY i.sort_order, i.code;
$$;

GRANT EXECUTE ON FUNCTION public.get_item_tree(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
