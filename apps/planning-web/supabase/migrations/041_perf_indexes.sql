-- ============================================================
-- Migration 041 — Performance indexes for hot paths
-- ============================================================

-- 1. items.parent_item_id — children lookup on item detail page
CREATE INDEX IF NOT EXISTS idx_items_parent_item_id
  ON public.items(parent_item_id) WHERE parent_item_id IS NOT NULL;

-- 2. bom_lines.bom_header_id — header → lines join
CREATE INDEX IF NOT EXISTS idx_bom_lines_bom_header_id
  ON public.bom_lines(bom_header_id);

-- 3. bom_lines.component_item_id — "used in" reverse lookup
CREATE INDEX IF NOT EXISTS idx_bom_lines_component_item_id
  ON public.bom_lines(component_item_id);

-- 4. items composite for tenant + type tab queries
CREATE INDEX IF NOT EXISTS idx_items_tenant_active_type_code
  ON public.items(tenant_id, is_active, item_type, code);

-- 5. supplier_items composite for item joins sorted by is_preferred
CREATE INDEX IF NOT EXISTS idx_supplier_items_item_preferred
  ON public.supplier_items(item_id, is_preferred DESC);

ANALYZE public.items;
ANALYZE public.bom_lines;
ANALYZE public.supplier_items;
