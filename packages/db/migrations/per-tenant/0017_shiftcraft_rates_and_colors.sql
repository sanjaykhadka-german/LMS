-- ShiftCraft per-tenant — add hourly_rate to sc_employees, color to sc_locations.
--
-- The tables already exist in every tenant_<uuid> schema (cloned via
-- LIKE INCLUDING ALL in 0011 / 0013), so this is a straight ALTER. The
-- public.sc_* templates pick up the same columns via the Drizzle-generated
-- 0005 migration that pnpm db:migrate-shiftcraft applies.
--
-- Idempotent (IF NOT EXISTS) so re-runs on partially-migrated tenants
-- don't fail.

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS hourly_rate numeric(10, 2);

ALTER TABLE sc_locations
  ADD COLUMN IF NOT EXISTS color text;

-- Recreate the CHECK constraint (the public template has it via the
-- Drizzle migration; tenant copies were cloned before the column existed
-- so they need it added explicitly).
ALTER TABLE sc_locations
  DROP CONSTRAINT IF EXISTS sc_locations_color_chk;
ALTER TABLE sc_locations
  ADD CONSTRAINT sc_locations_color_chk
  CHECK (color IS NULL OR color ~* '^#[0-9a-f]{6}$');
