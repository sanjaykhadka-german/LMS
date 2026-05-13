-- ============================================================================
-- 049  TENANT_ID DEFAULTS ON SETTINGS / REGISTER TABLES
-- ----------------------------------------------------------------------------
-- Several settings tables (item_types, item_categories, item_subcategories,
-- departments, rooms, locations, allergens, tax_codes, price_groups, ...)
-- declare tenant_id NOT NULL with no default. The UI form must remember to
-- explicitly inject tenant_id on every insert; if it forgets the row is
-- rejected by RLS with the (very unhelpful) "new row violates row-level
-- security policy" error.
--
-- Cleanest fix: set the column default to public.my_tenant_id() everywhere
-- it isn't already. Inserts then auto-populate correctly regardless of which
-- UI / SDK / API path performs them.
-- ============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'item_types', 'item_categories', 'item_subcategories',
    'departments', 'rooms', 'locations',
    'allergens', 'tax_codes', 'price_groups',
    'machines', 'pallet_configs',
    'item_barcodes',
    'suppliers', 'customers',
    'user_categories'
  ] LOOP
    -- Only act if the table exists, has a tenant_id column, and the column has no default
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t
         AND column_name = 'tenant_id'
         AND column_default IS NULL
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT public.my_tenant_id()', t);
      RAISE NOTICE 'Set DEFAULT my_tenant_id() on public.%.tenant_id', t;
    END IF;
  END LOOP;
END $$;
