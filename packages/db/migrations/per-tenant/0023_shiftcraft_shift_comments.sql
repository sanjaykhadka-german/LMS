-- ShiftCraft per-tenant — sc_shift_comments.
--
-- Append-only thread of notes on a single shift. Same per-tenant
-- pattern as the other sc_* tables.

-- 1. Table.
CREATE TABLE IF NOT EXISTS sc_shift_comments
  (LIKE public.sc_shift_comments INCLUDING ALL);

-- 2. Tenant default.
ALTER TABLE sc_shift_comments ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- 3. FKs.
--   shift_id: ON DELETE CASCADE so deleting a shift wipes its thread.
--   author_user_id: ON DELETE SET NULL so the audit-style history
--     survives when a person leaves.
ALTER TABLE sc_shift_comments
  ADD CONSTRAINT sc_shift_comments_shift_id_fkey
  FOREIGN KEY (shift_id) REFERENCES sc_shifts(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_shift_comments
  ADD CONSTRAINT sc_shift_comments_author_user_id_fkey
  FOREIGN KEY (author_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- 4. RLS.
ALTER TABLE sc_shift_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_shift_comments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_shift_comments;
CREATE POLICY tenant_isolation ON sc_shift_comments
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
