-- ShiftCraft per-tenant — kiosk surface (sc_employee_pins, sc_kiosk_devices,
-- sc_clock_event_photos).
--
-- Adds the three tables the on-premise kiosk needs:
--   - sc_employee_pins      : bcrypt PINs for kiosk auth
--   - sc_kiosk_devices      : registered tablets/laptops pinned to a location
--   - sc_clock_event_photos : selfies captured at punch time
--
-- Same per-tenant pattern as the other sc_* tables: clone the public template
-- via LIKE INCLUDING ALL (carries columns, defaults, check constraints, and
-- indexes — but NOT foreign keys), set the tracey_tenant_id default, re-attach
-- FKs to the per-tenant siblings, enable RLS.

-- ─── sc_employee_pins ───

CREATE TABLE IF NOT EXISTS sc_employee_pins
  (LIKE public.sc_employee_pins INCLUDING ALL);

ALTER TABLE sc_employee_pins ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- ON DELETE CASCADE: removing an auth user wipes their PIN. They can't use
-- the kiosk anyway.
ALTER TABLE sc_employee_pins
  ADD CONSTRAINT sc_employee_pins_app_user_id_fkey
  FOREIGN KEY (app_user_id) REFERENCES app.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

-- ON DELETE SET NULL: audit trail survives the manager who set the PIN
-- being removed from the tenant.
ALTER TABLE sc_employee_pins
  ADD CONSTRAINT sc_employee_pins_set_by_user_id_fkey
  FOREIGN KEY (set_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_employee_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_employee_pins FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_employee_pins;
CREATE POLICY tenant_isolation ON sc_employee_pins
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- ─── sc_kiosk_devices ───

CREATE TABLE IF NOT EXISTS sc_kiosk_devices
  (LIKE public.sc_kiosk_devices INCLUDING ALL);

ALTER TABLE sc_kiosk_devices ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- ON DELETE RESTRICT: don't allow deleting a location that still has
-- kiosks attached. Admin must revoke + delete kiosks first. Prevents
-- orphan kiosk rows pointing at vanished locations.
ALTER TABLE sc_kiosk_devices
  ADD CONSTRAINT sc_kiosk_devices_location_id_fkey
  FOREIGN KEY (location_id) REFERENCES sc_locations(id) ON DELETE RESTRICT
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_kiosk_devices
  ADD CONSTRAINT sc_kiosk_devices_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_kiosk_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_kiosk_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_kiosk_devices;
CREATE POLICY tenant_isolation ON sc_kiosk_devices
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- ─── sc_clock_event_photos ───

CREATE TABLE IF NOT EXISTS sc_clock_event_photos
  (LIKE public.sc_clock_event_photos INCLUDING ALL);

ALTER TABLE sc_clock_event_photos ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- ON DELETE CASCADE: if an admin corrects a clock event (deletes it), its
-- photo goes with it.
ALTER TABLE sc_clock_event_photos
  ADD CONSTRAINT sc_clock_event_photos_clock_event_id_fkey
  FOREIGN KEY (clock_event_id) REFERENCES sc_clock_events(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_clock_event_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_clock_event_photos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_clock_event_photos;
CREATE POLICY tenant_isolation ON sc_clock_event_photos
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
