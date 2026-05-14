-- ShiftCraft per-tenant — sc_tasks.
--
-- Tenant-scoped Kanban tasks. Same pattern as the existing sc_* tables:
-- LIKE-clone the public template, override tracey_tenant_id default to
-- the runner's GUC, re-attach cross-schema FKs to app.users and sibling
-- FK to sc_locations, enable RLS.

-- 1. Table.
CREATE TABLE IF NOT EXISTS sc_tasks (LIKE public.sc_tasks INCLUDING ALL);

-- 2. Tenant default.
ALTER TABLE sc_tasks ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- 3. FKs.
ALTER TABLE sc_tasks
  ADD CONSTRAINT sc_tasks_assignee_user_id_fkey
  FOREIGN KEY (assignee_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_tasks
  ADD CONSTRAINT sc_tasks_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_tasks
  ADD CONSTRAINT sc_tasks_location_id_fkey
  FOREIGN KEY (location_id) REFERENCES sc_locations(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- 4. RLS.
ALTER TABLE sc_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_tasks;
CREATE POLICY tenant_isolation ON sc_tasks
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
