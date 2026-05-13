-- Migration 037: indexes on items table + type-counts RPC
-- Every filter in Item Master was doing a full table scan. These indexes fix that.

-- Composite index covering the most common query pattern (tenant + type + code/name sort)
CREATE INDEX IF NOT EXISTS idx_items_tenant_type_code
  ON public.items(tenant_id, item_type, code);

-- Individual indexes for each filter column
CREATE INDEX IF NOT EXISTS idx_items_tenant_id
  ON public.items(tenant_id);

CREATE INDEX IF NOT EXISTS idx_items_item_type
  ON public.items(item_type);

CREATE INDEX IF NOT EXISTS idx_items_item_category_id
  ON public.items(item_category_id);

CREATE INDEX IF NOT EXISTS idx_items_item_subcategory_id
  ON public.items(item_subcategory_id);

CREATE INDEX IF NOT EXISTS idx_items_department
  ON public.items(department);

CREATE INDEX IF NOT EXISTS idx_items_is_active
  ON public.items(tenant_id, is_active);

-- Text search indexes for ILIKE filters on code and name
CREATE INDEX IF NOT EXISTS idx_items_code_trgm
  ON public.items USING gin(code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_items_name_trgm
  ON public.items USING gin(name gin_trgm_ops);

-- Enable the pg_trgm extension if not already enabled (needed for gin_trgm_ops)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Supplier items index for the supplier filter subquery
CREATE INDEX IF NOT EXISTS idx_supplier_items_supplier_id
  ON public.supplier_items(supplier_id);

CREATE INDEX IF NOT EXISTS idx_supplier_items_item_id
  ON public.supplier_items(item_id);

-- ── RPC: get_item_type_counts ─────────────────────────────────────────────────
-- Replaces the wasteful SELECT item_type RANGE(0,9999) with a server-side aggregate.
-- Respects RLS automatically (SECURITY INVOKER).
CREATE OR REPLACE FUNCTION public.get_item_type_counts()
RETURNS TABLE(item_type text, cnt bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT item_type, COUNT(*)::bigint AS cnt
  FROM public.items
  GROUP BY item_type;
$$;
