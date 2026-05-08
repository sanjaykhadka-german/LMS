-- Phase 5 hardening — enable Postgres Row Level Security on every
-- tenant-scoped legacy LMS table plus app.ai_studio_sessions, as a
-- defense-in-depth backstop to the existing application-layer
-- `WHERE tracey_tenant_id = $1` filter.
--
-- After this lands, a query that forgets the tenant filter — or a raw
-- SQL helper that bypasses Drizzle entirely — will silently return zero
-- rows instead of leaking across tenants. The discriminator pattern
-- (one `tracey_tenant_id text` column per legacy LMS table; one
-- `tenant_id uuid` column on app.ai_studio_sessions) is unchanged; this
-- migration only flips on the database-level safety net.
--
-- ─── PRECONDITIONS — DO NOT RUN BEFORE THESE ARE TRUE ────────────────
--
-- 1. Every query path that touches a covered table must set
--    `app.tenant_id` for the duration of the transaction. In Tracey
--    this is the `forTenant(tid).run((tx) => ...)` helper exposed via
--    `ctx.db` from `requireAdmin()` / `requireLearner()`. Run the CI
--    guard `pnpm -C apps/lms-web check-tenant-scope` and confirm zero
--    violations before applying.
--
-- 2. Flask must be FULLY retired (Phase 5). Any remaining Flask code
--    path that runs SELECT/INSERT/UPDATE/DELETE against these tables
--    without setting `app.tenant_id` will return zero rows / fail to
--    write once RLS is on. If a Flask cron job is still touching
--    audit_logs or whs_records, applying this migration will break it
--    silently. Decommission first, apply second.
--
-- 3. Anyone doing direct SQL via Render's psql shell or pgAdmin (see
--    reference_render_db.md) needs to run
--      SELECT set_config('app.tenant_id', '<tenant-uuid>', false);
--    at the start of their session, OR
--      SET row_security = off;
--    if they need cross-tenant visibility for an admin operation.
--
-- ─── HOW TO RUN ──────────────────────────────────────────────────────
--
-- Local:
--   psql "postgres://root:root@localhost:5432/lms" \
--        -f packages/db/migrations/manual/0004_enable_rls.sql
--
-- Render (lms-db PSQL shell):
--   \i 0004_enable_rls.sql
--
-- ─── VERIFICATION (run after applying) ───────────────────────────────
--
--   -- expect: 0 (RLS denies because GUC is NULL)
--   SELECT count(*) FROM departments;
--
--   -- expect: real GB count
--   BEGIN;
--   SELECT set_config('app.tenant_id', 'add6df90-...', true);  -- local GB tenant
--   SELECT count(*) FROM departments;
--   ROLLBACK;
--
-- ─── ROLLBACK ────────────────────────────────────────────────────────
--
--   BEGIN;
--   ALTER TABLE departments DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE departments NO FORCE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS tenant_isolation ON departments;
--   -- repeat for every table below
--   COMMIT;

-- NOTE: psql users may want to add `\set ON_ERROR_STOP on` above the BEGIN
-- when running with `psql -f`. It is intentionally omitted from the file so
-- the same script runs unmodified through pgAdmin's Query Tool, Render's
-- web psql shell, and other non-psql clients (the leading backslash is a
-- psql meta-command, not SQL, and triggers a 42601 syntax error elsewhere).
-- The BEGIN/COMMIT block below already gives transactional safety: any
-- error aborts the whole migration with no partial state.

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: re-create the policy idempotently. Postgres's CREATE POLICY does
-- not gain IF NOT EXISTS until PG16, so DROP-then-CREATE keeps the migration
-- safe to re-run on any supported version.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  -- Tables with `tracey_tenant_id text`. Order matches 0003_lms_multitenant.sql.
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
    -- 'users' is intentionally NOT covered yet. The legacy auth bridge in
    -- apps/lms-web/lib/auth/legacy-bridge.ts looks up rows in public.users
    -- by email at sign-in time, BEFORE any tenant context is set. With RLS
    -- on this table, that lookup would silently return zero rows and lock
    -- out every Flask-era user who hasn't yet migrated to app.users.
    --
    -- Re-add this entry in a future Phase 5.x cleanup, gated on:
    --   SELECT count(*) FROM public.users WHERE tracey_user_id IS NULL = 0
    -- (i.e. every legacy user has signed in at least once and has a
    -- linked Tracey row), at which point the bridge can be deleted and
    -- public.users becomes RLS-safe.
  ];
BEGIN
  FOREACH t IN ARRAY text_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (tracey_tenant_id = current_setting(''app.tenant_id'', true)) '
      'WITH CHECK (tracey_tenant_id = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;
END$$;

-- ---------------------------------------------------------------------------
-- app.ai_studio_sessions — Tracey-native, tenant_id is uuid not text.
-- The cast keeps the policy comparable against the GUC string value.
-- ---------------------------------------------------------------------------

ALTER TABLE app.ai_studio_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_studio_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.ai_studio_sessions;
CREATE POLICY tenant_isolation ON app.ai_studio_sessions
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------------
-- NOT covered (auth/billing tables — scoped by uuid foreign-keys, queried
-- across tenants by the platform-admin surface, and required for sign-in):
--
--   app.users, app.accounts, app.sessions, app.verification_tokens,
--   app.tenants, app.members, app.invitations, app.processed_stripe_events,
--   app.audit_events
--
-- Locking these with the same GUC-based policy would break sign-in (the
-- session lookup happens before requireAdmin/requireLearner ever runs)
-- and break /platform (cross-tenant by design).
-- ---------------------------------------------------------------------------

COMMIT;
