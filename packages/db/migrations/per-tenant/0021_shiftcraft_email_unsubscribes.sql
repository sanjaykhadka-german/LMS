-- ShiftCraft per-tenant — sc_email_unsubscribes.
--
-- Opt-out ledger for email notifications. Presence of a row =
-- "don't email this user for this kind". Absence = subscribed.

-- 1. Table.
CREATE TABLE IF NOT EXISTS sc_email_unsubscribes
  (LIKE public.sc_email_unsubscribes INCLUDING ALL);

-- 2. Tenant default.
ALTER TABLE sc_email_unsubscribes ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- 3. FK to app.users.
ALTER TABLE sc_email_unsubscribes
  ADD CONSTRAINT sc_email_unsubscribes_app_user_id_fkey
  FOREIGN KEY (app_user_id) REFERENCES app.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

-- 4. RLS.
ALTER TABLE sc_email_unsubscribes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_email_unsubscribes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_email_unsubscribes;
CREATE POLICY tenant_isolation ON sc_email_unsubscribes
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
