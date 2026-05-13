-- Migration 031: item_subcategories table + item_subcategory_id on items

CREATE TABLE IF NOT EXISTS public.item_subcategories (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.item_categories(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.item_subcategories ENABLE ROW LEVEL SECURITY;

CREATE POLICY item_subcategories_tenant ON public.item_subcategories
  FOR ALL USING (tenant_id = public.my_tenant_id());

CREATE INDEX IF NOT EXISTS idx_item_subcategories_category ON public.item_subcategories(category_id);

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS item_subcategory_id uuid REFERENCES public.item_subcategories(id) ON DELETE SET NULL;
