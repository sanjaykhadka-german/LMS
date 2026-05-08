-- ─── Rollback for 0004_enable_rls.sql ──────────────────────────────────
--
-- Phase 5 applied RLS to 19 legacy LMS tables + app.ai_studio_sessions
-- on the assumption that every read/write path was already wrapped in
-- forTenant(tid) / ctx.db.run((tx) => …). It was not — only ~4 of 41 query
-- sites in apps/lms-web/ use the ctx.db.run pattern. The remaining bare-db
-- queries pass `WHERE tracey_tenant_id = $1` filters but do NOT set
-- `app.tenant_id`, so under RLS they silently return zero rows.
--
-- This rollback turns RLS off everywhere it was enabled by
-- 0004_enable_rls.sql, restoring the pre-Phase-5 query behaviour. The
-- application-layer `tenantWhere(...)` filters continue to provide
-- single-layer isolation just like they did before Phase 5; defense-
-- in-depth via RLS is deferred to a future phase that migrates every
-- query path to ctx.db.run first.
--
-- Run via pgAdmin (Query Tool) or `psql -f` — fully portable, idempotent.
-- No data is modified by this script. Tables, rows, and the
-- `tracey_tenant_id` columns are untouched. Only RLS metadata changes.
--
-- After running, smoke-test admin pages: employees, modules, assignments,
-- audit logs, training matrix. They should render with data again.

BEGIN;

DO $$
DECLARE
  t text;
  text_tables text[] := ARRAY[
    'departments',
    'employers',
    'machines',
    'positions',
    'modules',
    'assignments',
    'attempts',
    'content_items',
    'content_item_media',
    'module_media',
    'questions',
    'choices',
    'module_versions',
    'uploaded_files',
    'department_module_policies',
    'user_machines',
    'machine_modules',
    'whs_records',
    'audit_logs'
  ];
BEGIN
  FOREACH t IN ARRAY text_tables LOOP
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
  END LOOP;
END$$;

ALTER TABLE app.ai_studio_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_studio_sessions NO FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.ai_studio_sessions;

COMMIT;

-- Verification queries (run after the COMMIT):
--   -- Should return real GB count, not 0:
--   SELECT count(*) FROM departments;
--   SELECT count(*) FROM modules;
--
--   -- Confirm RLS metadata is off on every table this rollback covers:
--   SELECT relname, relrowsecurity, relforcerowsecurity
--     FROM pg_class
--    WHERE relname IN (
--      'departments','employers','machines','positions','modules',
--      'assignments','attempts','content_items','content_item_media',
--      'module_media','questions','choices','module_versions',
--      'uploaded_files','department_module_policies','user_machines',
--      'machine_modules','whs_records','audit_logs','ai_studio_sessions'
--    );
--   -- Expect both columns = false everywhere.
