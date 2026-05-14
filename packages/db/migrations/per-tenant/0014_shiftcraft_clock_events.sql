-- ShiftCraft per-tenant — sc_clock_events.
--
-- Mirrors the 0011_shiftcraft_baseline / 0013_shiftcraft_employees pattern.
-- Append-only stream of clock punches; derived state computed in app code.

-- 1. Table.
CREATE TABLE IF NOT EXISTS sc_clock_events (LIKE public.sc_clock_events INCLUDING ALL);

-- 2. Tenant default.
ALTER TABLE sc_clock_events ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- 3. FKs: app.users (cross-schema) + sc_locations (sibling, optional).
ALTER TABLE sc_clock_events
  ADD CONSTRAINT sc_clock_events_app_user_id_fkey
  FOREIGN KEY (app_user_id) REFERENCES app.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_clock_events
  ADD CONSTRAINT sc_clock_events_location_id_fkey
  FOREIGN KEY (location_id) REFERENCES sc_locations(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- 4. RLS.
ALTER TABLE sc_clock_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_clock_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_clock_events;
CREATE POLICY tenant_isolation ON sc_clock_events
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
