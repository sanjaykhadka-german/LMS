-- ============================================================
-- Migration 039 — Item Master extras
-- Adds:
--   • items.is_rte                    (Ready-to-Eat flag)
--   • items.ingredients_statement     (Label-ready ingredients listing)
--   • item_images table (was never applied to the live DB)
--   • item_images.image_type          (product / inner / outer / pallet / other)
--   • item_spec_documents.document_type adds 'pif'
-- ============================================================

-- ─── 1. Items ──────────────────────────────────────────────
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS is_rte                boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ingredients_statement text;

COMMENT ON COLUMN public.items.is_rte IS
  'Ready-to-Eat. true = product can be consumed without further cooking.';
COMMENT ON COLUMN public.items.ingredients_statement IS
  'Label-ready ingredients listing in descending order by weight (incl. % declarations and allergens in caps).';

-- ─── 2. item_images table + image_type column ─────────────
CREATE TABLE IF NOT EXISTS public.item_images (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id      uuid NOT NULL REFERENCES public.items(id)  ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name    text NOT NULL,
  mime_type    text NOT NULL DEFAULT 'image/jpeg',
  size_bytes   integer,
  is_primary   boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 0,
  uploaded_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS item_images_primary_idx
  ON public.item_images(item_id) WHERE is_primary = true;

ALTER TABLE public.item_images
  ADD COLUMN IF NOT EXISTS image_type text NOT NULL DEFAULT 'other';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_images_image_type_check') THEN
    ALTER TABLE public.item_images
      ADD CONSTRAINT item_images_image_type_check
      CHECK (image_type IN ('product','inner','outer','pallet','other'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS item_images_type_idx
  ON public.item_images(item_id, image_type);

COMMENT ON COLUMN public.item_images.image_type IS
  'Categorises packaging photos: product=hero, inner=inner pack, outer=carton, pallet=pallet shot, other=misc.';

-- RLS for item_images
ALTER TABLE public.item_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_images_tenant_select ON public.item_images;
CREATE POLICY item_images_tenant_select ON public.item_images
  FOR SELECT USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS item_images_tenant_insert ON public.item_images;
CREATE POLICY item_images_tenant_insert ON public.item_images
  FOR INSERT WITH CHECK (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS item_images_tenant_update ON public.item_images;
CREATE POLICY item_images_tenant_update ON public.item_images
  FOR UPDATE USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS item_images_tenant_delete ON public.item_images;
CREATE POLICY item_images_tenant_delete ON public.item_images
  FOR DELETE USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- ─── 3. Item spec documents: extend type list to include PIF ─
DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'public.item_spec_documents'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%document_type%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.item_spec_documents DROP CONSTRAINT %I', cname);
  END IF;
END$$;

ALTER TABLE public.item_spec_documents
  ADD CONSTRAINT item_spec_documents_document_type_check
  CHECK (document_type IN (
    'spec_sheet','coa','sds','allergen_decl','nutritional','micro_report',
    'supplier_spec','pif','other'
  ));

COMMENT ON COLUMN public.item_spec_documents.document_type IS
  'Type of supplier document. pif = Product Information Form (typically supplier-provided for raw materials).';
