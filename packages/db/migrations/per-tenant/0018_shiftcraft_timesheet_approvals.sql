-- ShiftCraft per-tenant — sc_timesheet_approvals.
--
-- Per-(employee, week) approval ledger. Same per-tenant pattern as the
-- other sc_* tables: LIKE-clone the public template, override the
-- tracey_tenant_id default, re-attach FKs to app.users, enable RLS.

-- 1. Table.
CREATE TABLE IF NOT EXISTS sc_timesheet_approvals
  (LIKE public.sc_timesheet_approvals INCLUDING ALL);

-- 2. Tenant default.
ALTER TABLE sc_timesheet_approvals ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- 3. FKs to app.users.
ALTER TABLE sc_timesheet_approvals
  ADD CONSTRAINT sc_timesheet_approvals_employee_user_id_fkey
  FOREIGN KEY (employee_user_id) REFERENCES app.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_timesheet_approvals
  ADD CONSTRAINT sc_timesheet_approvals_approved_by_user_id_fkey
  FOREIGN KEY (approved_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- 4. RLS.
ALTER TABLE sc_timesheet_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_timesheet_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_timesheet_approvals;
CREATE POLICY tenant_isolation ON sc_timesheet_approvals
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
