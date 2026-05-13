-- ShiftCraft per-tenant baseline.
--
-- Applied by `packages/db/src/per-tenant-migrate.ts` inside each tenant
-- schema with:
--   SET LOCAL search_path = "tenant_<uuid>", public
--   SELECT set_config('app.tenant_id', '<uuid>', true)
--
-- Unqualified `sc_*` references below resolve into the tenant's schema.
-- `app.users` is explicitly qualified because `app` is intentionally not on
-- the search_path (see client.ts forTenant() comment for why).
--
-- The four `public.sc_*` template tables must already exist (created by
-- `pnpm db:migrate-shiftcraft`). LIKE INCLUDING ALL copies their structure
-- (columns, defaults, CHECK constraints, indexes) but NOT their FKs — those
-- are recreated below pointing at this tenant's sibling tables.

-- 1. Tables.
CREATE TABLE IF NOT EXISTS sc_locations (LIKE public.sc_locations INCLUDING ALL);
CREATE TABLE IF NOT EXISTS sc_shifts (LIKE public.sc_shifts INCLUDING ALL);
CREATE TABLE IF NOT EXISTS sc_shift_assignments (LIKE public.sc_shift_assignments INCLUDING ALL);
CREATE TABLE IF NOT EXISTS sc_time_off_requests (LIKE public.sc_time_off_requests INCLUDING ALL);

-- 2. Override tracey_tenant_id DEFAULT to this tenant (read from the GUC
--    set by the migration runner). After this, Drizzle INSERTs that omit
--    tracey_tenant_id pick it up automatically inside ctx.db.run().
ALTER TABLE sc_locations ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE sc_shifts ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE sc_time_off_requests ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);
-- sc_shift_assignments has no tracey_tenant_id (denormalized away — the
-- parent sc_shifts row carries it; sc_shift_assignments is reachable only
-- via sc_shifts.shift_id which lives in the same per-tenant schema).

-- 3. Within-shiftcraft FKs (point at this tenant's sibling tables).
ALTER TABLE sc_shifts
  ADD CONSTRAINT sc_shifts_location_id_fkey
  FOREIGN KEY (location_id) REFERENCES sc_locations(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_shift_assignments
  ADD CONSTRAINT sc_shift_assignments_shift_id_fkey
  FOREIGN KEY (shift_id) REFERENCES sc_shifts(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

-- 4. FKs to cross-tenant identity (app.users — stays at the app schema).
ALTER TABLE sc_shifts
  ADD CONSTRAINT sc_shifts_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_shift_assignments
  ADD CONSTRAINT sc_shift_assignments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_time_off_requests
  ADD CONSTRAINT sc_time_off_requests_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_time_off_requests
  ADD CONSTRAINT sc_time_off_requests_reviewed_by_user_id_fkey
  FOREIGN KEY (reviewed_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- 5. RLS — defence-in-depth on top of physical schema isolation. Same
--    policy shape as the LMS per-tenant tables (per-tenant-schema.ts step 6).
ALTER TABLE sc_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_locations;
CREATE POLICY tenant_isolation ON sc_locations
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE sc_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_shifts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_shifts;
CREATE POLICY tenant_isolation ON sc_shifts
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE sc_time_off_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_time_off_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_time_off_requests;
CREATE POLICY tenant_isolation ON sc_time_off_requests
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- sc_shift_assignments has no tracey_tenant_id; tenant isolation here is
-- physical (the table only exists per-tenant) + via the FK to sc_shifts
-- which IS tenant-tagged. RLS would need a subquery against sc_shifts to
-- enforce — skip for now and rely on the FK chain + physical isolation.
