-- ============================================================================
-- 051  TENANT_ID DEFAULTS — sweep across every remaining table
-- ----------------------------------------------------------------------------
-- Migration 049 set tenant_id = my_tenant_id() on the settings/register tables.
-- This sweep applies the same default to every other public.* table that
-- declares tenant_id NOT NULL with no default. Without it, any UI form that
-- forgets to inject tenant_id explicitly is rejected by RLS with the "new row
-- violates row-level security policy" error (see e.g. /plans/new today,
-- and previously /settings/item-types).
--
-- The default is harmless when the form does pass tenant_id explicitly
-- (the explicit value wins). It only fires when tenant_id is omitted from
-- the INSERT.
-- ============================================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'tenant_id'
      AND is_nullable = 'NO'
      AND column_default IS NULL
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT public.my_tenant_id()',
      r.table_name
    );
    RAISE NOTICE 'Set DEFAULT my_tenant_id() on public.%.tenant_id', r.table_name;
  END LOOP;
END $$;
