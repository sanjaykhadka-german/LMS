-- Phase 8 — admin-managed WHS kinds.
--
-- Adds public.whs_kinds as the template for per-tenant provisioning:
-- provisionSql() runs `CREATE TABLE tenant_<id>.whs_kinds (LIKE public.whs_kinds INCLUDING ALL)`
-- for every new tenant after this migration ships. The companion
-- per-tenant migration (0009_whs_kinds.sql) creates the table inside
-- each already-provisioned tenant_<id> schema.
--
-- Idempotent. No data ever lands in public.whs_kinds — it's a frozen
-- template, matching every other LMS table in public after Phase 7c.
--
-- HOW TO RUN
-- ----------
-- Local:
--   psql "postgres://root:root@localhost:5432/lms" \
--        -f packages/db/migrations/manual/0005_whs_kinds_public.sql
--
-- Render: open the lms-db service in the Render dashboard, click "PSQL"
--   to get a shell already wired to the live DB, then \i the file.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS public.whs_kinds (
  id integer NOT NULL,
  slug text NOT NULL,
  label text NOT NULL,
  category text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamp without time zone DEFAULT now(),
  tracey_tenant_id text NOT NULL DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8',
  CONSTRAINT whs_kinds_category_chk CHECK (category IN ('expiry', 'incident'))
);

CREATE SEQUENCE IF NOT EXISTS public.whs_kinds_id_seq AS integer;
ALTER SEQUENCE public.whs_kinds_id_seq OWNED BY public.whs_kinds.id;
ALTER TABLE public.whs_kinds
  ALTER COLUMN id SET DEFAULT nextval('public.whs_kinds_id_seq'::regclass);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whs_kinds_pkey' AND conrelid = 'public.whs_kinds'::regclass
  ) THEN
    ALTER TABLE public.whs_kinds ADD CONSTRAINT whs_kinds_pkey PRIMARY KEY (id);
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS ix_whs_kinds_tenant_slug
  ON public.whs_kinds (tracey_tenant_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS ix_whs_kinds_tenant_label
  ON public.whs_kinds (tracey_tenant_id, label);
CREATE INDEX IF NOT EXISTS whs_kinds_tenant_idx
  ON public.whs_kinds (tracey_tenant_id);

-- Match the RLS posture of every other LMS table in public.
ALTER TABLE public.whs_kinds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whs_kinds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.whs_kinds;
CREATE POLICY tenant_isolation ON public.whs_kinds
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- Freeze posture (Phase 7c `phase7c_frozen` CHECK (false)) is intentionally
-- omitted here. public.whs_kinds is template-only from inception — no
-- application code path ever writes to it, so there's no legacy access to
-- shut. Skipping the constraint also avoids a collision with freezeSql() if
-- a future tenant-freeze run executes it across LMS_TABLES.

COMMIT;
