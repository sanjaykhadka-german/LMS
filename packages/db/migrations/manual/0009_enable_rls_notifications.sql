-- Enable RLS on app.notifications, mirroring what 0004_enable_rls.sql did
-- for app.ai_studio_sessions. The notifications table is per-tenant via
-- tenant_id (uuid); without this, application code that forgets the
-- WHERE tenant_id = $1 filter could leak across tenants. With it, the
-- enforced policy admits only rows whose tenant_id matches the current
-- `app.tenant_id` GUC — which the new forTenant(tid) wrappers in
-- lib/lms/notifications.ts and api/notifications/route.ts set inside
-- their transactions.
--
-- ─── PRECONDITIONS ────────────────────────────────────────────────────
--
-- Apply ONLY after the calling code has been migrated to set
-- `app.tenant_id` for every read/write on app.notifications. As of
-- commit landing this migration:
--   - lib/lms/notifications.ts createNotification(s) takes TenantDb
--   - app/api/notifications/route.ts wraps reads + updates in
--     forTenant(tid).run(...)
--   - app/app/admin/modules/[id]/assign/actions.ts passes ctx.db
--
-- If a future caller of these tables forgets the wrapper, RLS will
-- silently filter their queries to zero rows (or fail INSERTs with a
-- WITH CHECK violation) on prod's non-superuser role. Runtime failure
-- is intentional — that's the defence-in-depth.
--
-- ─── HOW TO RUN ──────────────────────────────────────────────────────
--
-- Local:
--   psql "postgres://root:root@localhost:5432/lms_dev" \
--        -f packages/db/migrations/manual/0009_enable_rls_notifications.sql
--
-- Render (lms-db, via pgAdmin or psql):
--   Paste this file's body into the Query Tool and run.
--
-- Idempotent — DROP POLICY IF EXISTS + CREATE POLICY.

BEGIN;

ALTER TABLE app.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.notifications;
CREATE POLICY tenant_isolation ON app.notifications
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

COMMIT;

-- Verification (run after applying):
--   -- Should be true / true
--   SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--    WHERE relname = 'notifications' AND relnamespace = 'app'::regnamespace;
--
--   -- Policy exists
--   SELECT policyname FROM pg_policies
--    WHERE schemaname = 'app' AND tablename = 'notifications';
--
--   -- Without GUC: returns 0
--   SELECT count(*) FROM app.notifications;
--
--   -- With GUC: returns the tenant's notifications
--   BEGIN;
--   SELECT set_config('app.tenant_id', '<tenant-uuid>', true);
--   SELECT count(*) FROM app.notifications;
--   ROLLBACK;
