-- ShiftCraft per-tenant — sc_announcements.
--
-- Tenant-scoped pinned messages for the dashboard. Same pattern as the
-- other sc_* tables: LIKE-clone, tenant default, FK to app.users, RLS.

-- 1. Table.
CREATE TABLE IF NOT EXISTS sc_announcements (LIKE public.sc_announcements INCLUDING ALL);

-- 2. Tenant default.
ALTER TABLE sc_announcements ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- 3. FK.
ALTER TABLE sc_announcements
  ADD CONSTRAINT sc_announcements_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- 4. RLS.
ALTER TABLE sc_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_announcements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_announcements;
CREATE POLICY tenant_isolation ON sc_announcements
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
