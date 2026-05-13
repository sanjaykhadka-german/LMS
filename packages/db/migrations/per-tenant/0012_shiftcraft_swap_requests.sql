-- ShiftCraft per-tenant — sc_shift_swap_requests.
--
-- Mirrors the 0011_shiftcraft_baseline pattern: LIKE-clone the template
-- table from public, override the tracey_tenant_id default to this tenant
-- (GUC set by the runner), then re-attach FKs pointing at this tenant's
-- siblings, and enable RLS for defence-in-depth.

-- 1. Table.
CREATE TABLE IF NOT EXISTS sc_shift_swap_requests
  (LIKE public.sc_shift_swap_requests INCLUDING ALL);

-- 2. Tenant default.
ALTER TABLE sc_shift_swap_requests ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- 3. FKs to this tenant's sc_shift_assignments. ON DELETE CASCADE so that
--    deleting a shift (which cascades to its assignments) also cleans up
--    any dangling swap requests pointing at those assignments.
ALTER TABLE sc_shift_swap_requests
  ADD CONSTRAINT sc_shift_swap_requests_initiator_assignment_id_fkey
  FOREIGN KEY (initiator_assignment_id) REFERENCES sc_shift_assignments(id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_shift_swap_requests
  ADD CONSTRAINT sc_shift_swap_requests_target_assignment_id_fkey
  FOREIGN KEY (target_assignment_id) REFERENCES sc_shift_assignments(id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

-- 4. FKs to cross-tenant identity.
ALTER TABLE sc_shift_swap_requests
  ADD CONSTRAINT sc_shift_swap_requests_initiator_user_id_fkey
  FOREIGN KEY (initiator_user_id) REFERENCES app.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_shift_swap_requests
  ADD CONSTRAINT sc_shift_swap_requests_target_user_id_fkey
  FOREIGN KEY (target_user_id) REFERENCES app.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

-- 5. RLS. tracey_tenant_id is on the row so we can mirror the sc_shifts
--    policy directly (unlike sc_shift_assignments, which omits tenant_id
--    and relies on FK-chain isolation).
ALTER TABLE sc_shift_swap_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_shift_swap_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_shift_swap_requests;
CREATE POLICY tenant_isolation ON sc_shift_swap_requests
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
