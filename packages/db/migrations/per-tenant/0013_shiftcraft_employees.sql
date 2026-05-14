-- ShiftCraft per-tenant — sc_employees.
--
-- Mirrors the 0011_shiftcraft_baseline / 0012_shiftcraft_swap_requests
-- pattern: LIKE-clone the public.sc_employees template into this tenant's
-- schema, override the tracey_tenant_id default to this tenant (GUC set by
-- the runner), re-attach FKs pointing at app.users, and enable RLS for
-- defence-in-depth.

-- 1. Table.
CREATE TABLE IF NOT EXISTS sc_employees (LIKE public.sc_employees INCLUDING ALL);

-- 2. Tenant default — Drizzle INSERTs that omit tracey_tenant_id inside
--    ctx.db.run() will now pick it up automatically.
ALTER TABLE sc_employees ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- 3. FKs to cross-tenant identity (app.users — stays at the app schema).
--    app_user_id is the optional link from a ShiftCraft employee to their
--    Tracey login account; created_by_user_id records the admin who entered
--    the row. Both SET NULL on user delete so employee history survives.
ALTER TABLE sc_employees
  ADD CONSTRAINT sc_employees_app_user_id_fkey
  FOREIGN KEY (app_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_employees
  ADD CONSTRAINT sc_employees_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- 4. RLS. tracey_tenant_id is on the row so the policy mirrors sc_locations /
--    sc_shifts / sc_time_off_requests directly.
ALTER TABLE sc_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_employees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_employees;
CREATE POLICY tenant_isolation ON sc_employees
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
