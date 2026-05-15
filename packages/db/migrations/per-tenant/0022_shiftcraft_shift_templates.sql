-- ShiftCraft per-tenant — sc_shift_templates.
--
-- Saved shift patterns (location + role + time-of-day + notes) that
-- managers can stamp onto a chosen date from /app/schedule/new. Same
-- per-tenant pattern as the other sc_* tables.

-- 1. Table.
CREATE TABLE IF NOT EXISTS sc_shift_templates
  (LIKE public.sc_shift_templates INCLUDING ALL);

-- 2. Tenant default.
ALTER TABLE sc_shift_templates ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- 3. FK to this tenant's sc_locations. Templates can't outlive their
--    location; ON DELETE CASCADE keeps the data clean if a site closes.
ALTER TABLE sc_shift_templates
  ADD CONSTRAINT sc_shift_templates_location_id_fkey
  FOREIGN KEY (location_id) REFERENCES sc_locations(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

-- 4. RLS.
ALTER TABLE sc_shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_shift_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_shift_templates;
CREATE POLICY tenant_isolation ON sc_shift_templates
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
