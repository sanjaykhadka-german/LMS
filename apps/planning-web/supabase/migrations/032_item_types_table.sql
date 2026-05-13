-- Migration 032: item_types table with behaviour flags + convert items.item_type enum to text

-- 1. Create item_types table
CREATE TABLE IF NOT EXISTS public.item_types (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name          text NOT NULL,
  description   text,
  color         text NOT NULL DEFAULT '#6B7280',
  is_purchasable   boolean NOT NULL DEFAULT false,
  can_have_bom     boolean NOT NULL DEFAULT false,
  is_sellable      boolean NOT NULL DEFAULT false,
  is_producible    boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (tenant_id, code)
);

ALTER TABLE public.item_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY item_types_tenant ON public.item_types
  FOR ALL USING (tenant_id = public.my_tenant_id());

CREATE INDEX IF NOT EXISTS idx_item_types_tenant ON public.item_types(tenant_id);

-- 2. Seed standard types for every existing tenant
INSERT INTO public.item_types (tenant_id, code, name, color, is_purchasable, can_have_bom, is_sellable, is_producible, sort_order)
SELECT
  t.id,
  v.code,
  v.name,
  v.color,
  v.is_purchasable,
  v.can_have_bom,
  v.is_sellable,
  v.is_producible,
  v.sort_order
FROM public.tenants t
CROSS JOIN (VALUES
  ('raw_material', 'Raw Material', '#3B82F6', true,  false, false, false, 1),
  ('packaging',    'Packaging',    '#8B5CF6', true,  false, false, false, 2),
  ('wip',          'WIP',          '#F59E0B', false, true,  false, true,  3),
  ('fill',         'Fill',         '#EC4899', false, true,  false, true,  4),
  ('finished_good','Finished Good','#10B981', false, true,  true,  true,  5),
  ('consumable',   'Consumable',   '#6B7280', true,  false, false, false, 6)
) AS v(code, name, color, is_purchasable, can_have_bom, is_sellable, is_producible, sort_order)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- 3. Convert items.item_type from enum to text
-- First drop the default if it references the enum, then alter type
ALTER TABLE public.items ALTER COLUMN item_type DROP DEFAULT;
ALTER TABLE public.items ALTER COLUMN item_type TYPE text USING item_type::text;

-- Restore a sensible default
ALTER TABLE public.items ALTER COLUMN item_type SET DEFAULT 'raw_material';
