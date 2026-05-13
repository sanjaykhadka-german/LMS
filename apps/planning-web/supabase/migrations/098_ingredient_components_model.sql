-- ============================================================================
-- 098  Ingredient composition model (revised after Tino May 2026 feedback)
-- ----------------------------------------------------------------------------
-- The flat columns added in mig 097 (items.ingredient_class / e_number /
-- meat_species) collapse the moment a raw material is itself a blend (Opti
-- Form ACE S61 has 4 declared ingredients across 2 classes). Replacing with:
--
--   ingredient_classifications  - per-tenant register of FSANZ-aligned
--                                  classes the operator maintains in
--                                  /settings. Drives the Class dropdown
--                                  on the components grid + the grouping
--                                  in the spec auto-fill.
--
--   item_ingredient_components  - composition rows for each item. One row
--                                  for a simple raw material (Pork Topside
--                                  -> Meat / Pork / AU). Many rows for
--                                  compound inputs (Opti Form ACE -> 325,
--                                  262(i), 262(ii), Silica processing aid).
--                                  Carries percentage, country_of_origin,
--                                  meat_species, is_processing_aid.
--
--   product_specs.show_coo_detail - per-spec toggle: spec renders just the
--                                    FSANZ summary statement (default) or
--                                    summary + per-component country
--                                    breakdown for retail customers.
-- ============================================================================

ALTER TABLE public.items
  DROP COLUMN IF EXISTS ingredient_class,
  DROP COLUMN IF EXISTS ingredient_e_number,
  DROP COLUMN IF EXISTS ingredient_meat_species;

CREATE TABLE IF NOT EXISTS public.ingredient_classifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code         text NOT NULL,
  label        text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  default_australian boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS ingredient_classifications_tenant_idx
  ON public.ingredient_classifications(tenant_id);

ALTER TABLE public.ingredient_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY ingredient_classifications_select ON public.ingredient_classifications
  FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY ingredient_classifications_insert ON public.ingredient_classifications
  FOR INSERT WITH CHECK (tenant_id = my_tenant_id() AND is_manager_or_above());
CREATE POLICY ingredient_classifications_update ON public.ingredient_classifications
  FOR UPDATE USING (tenant_id = my_tenant_id() AND is_manager_or_above());
CREATE POLICY ingredient_classifications_delete ON public.ingredient_classifications
  FOR DELETE USING (tenant_id = my_tenant_id() AND is_manager_or_above());

CREATE TABLE IF NOT EXISTS public.item_ingredient_components (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id           uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  sort_order        integer NOT NULL DEFAULT 0,
  name              text NOT NULL,
  classification_id uuid REFERENCES public.ingredient_classifications(id) ON DELETE SET NULL,
  e_number          text,
  percentage        numeric,
  meat_species      text,
  country_of_origin text,
  is_processing_aid boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iic_tenant_idx ON public.item_ingredient_components(tenant_id);
CREATE INDEX IF NOT EXISTS iic_item_idx   ON public.item_ingredient_components(item_id);
CREATE INDEX IF NOT EXISTS iic_class_idx  ON public.item_ingredient_components(classification_id);

ALTER TABLE public.item_ingredient_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY iic_select ON public.item_ingredient_components
  FOR SELECT USING (tenant_id = my_tenant_id());
CREATE POLICY iic_insert ON public.item_ingredient_components
  FOR INSERT WITH CHECK (tenant_id = my_tenant_id() AND is_manager_or_above());
CREATE POLICY iic_update ON public.item_ingredient_components
  FOR UPDATE USING (tenant_id = my_tenant_id() AND is_manager_or_above());
CREATE POLICY iic_delete ON public.item_ingredient_components
  FOR DELETE USING (tenant_id = my_tenant_id() AND is_manager_or_above());

ALTER TABLE public.product_specs
  ADD COLUMN IF NOT EXISTS show_coo_detail boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.product_specs.show_coo_detail IS
  'When TRUE the spec sheet renders both the FSANZ summary CoO statement and a detailed per-component country breakdown table. Default FALSE = summary only.';

-- Seed: starter classifications for every tenant. Operator can edit /
-- extend via /settings/ingredient-classifications.
INSERT INTO public.ingredient_classifications (tenant_id, code, label, sort_order, default_australian)
SELECT t.id, c.code, c.label, c.sort_order, c.default_australian
FROM public.tenants t
CROSS JOIN (VALUES
  ('meat',              'Meat',                  10, false),
  ('water',             'Water',                 20, true ),
  ('mineral_salt',      'Mineral Salt',          30, false),
  ('preservative',      'Preservative',          40, false),
  ('antioxidant',       'Antioxidant',           50, false),
  ('acidity_regulator', 'Acidity Regulator',     60, false),
  ('anti_caking_agent', 'Anti-Caking Agent',     70, false),
  ('spice',             'Spice',                 80, false),
  ('spice_extract',     'Spice Extract',         90, false),
  ('herb',              'Herb',                 100, false),
  ('starch',            'Starch',               110, false),
  ('binder',            'Binder',               120, false),
  ('humectant',         'Humectant',            130, false),
  ('colour',            'Colour',               140, false),
  ('flavour',           'Flavour Enhancer',     150, false),
  ('casing',            'Casing',               160, false),
  ('packaging',         'Packaging',            170, false),
  ('consumable',        'Consumable',           180, false),
  ('other',             'Other',                999, false)
) AS c(code, label, sort_order, default_australian)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ingredient_classifications c2
  WHERE c2.tenant_id = t.id AND c2.code = c.code
);
