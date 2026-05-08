-- Phase 4 Slice 3 — multi-tenant retrofit for the legacy Flask LMS tables.
-- RENDER-SPECIFIC COPY: tenant id baked in for tenant
--   7a055706-c2f4-4325-8631-2ddf42bfa6ce
-- and psql meta-commands removed so this runs in pgAdmin's Query Tool.
--
-- One-shot. After running successfully on Render, you can delete this file —
-- the parameterised version (0003_lms_multitenant.sql) is the source of truth
-- in git.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ADD COLUMN (nullable for now so existing rows can keep their identity).
-- ---------------------------------------------------------------------------

ALTER TABLE departments               ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE employers                 ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE machines                  ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE positions                 ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE modules                   ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE assignments               ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE attempts                  ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE content_items             ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE content_item_media        ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE module_media              ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE questions                 ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE choices                   ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE module_versions           ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE uploaded_files            ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE department_module_policies ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE user_machines             ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE machine_modules           ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE whs_records               ADD COLUMN IF NOT EXISTS tracey_tenant_id text;
ALTER TABLE audit_logs                ADD COLUMN IF NOT EXISTS tracey_tenant_id text;

-- ---------------------------------------------------------------------------
-- 2. BACKFILL — every existing row predates multi-tenancy and was created
--    under the single LMS_ALLOWED_TENANT_ID Flask was pinned to.
-- ---------------------------------------------------------------------------

UPDATE departments               SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE employers                 SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE machines                  SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE positions                 SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE modules                   SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE assignments               SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE attempts                  SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE content_items             SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE content_item_media        SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE module_media              SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE questions                 SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE choices                   SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE module_versions           SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE uploaded_files            SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE department_module_policies SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE user_machines             SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE machine_modules           SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE whs_records               SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE audit_logs                SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;
UPDATE users                     SET tracey_tenant_id = '7a055706-c2f4-4325-8631-2ddf42bfa6ce' WHERE tracey_tenant_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3. LOCK DOWN — NOT NULL + DEFAULT.
-- ---------------------------------------------------------------------------

ALTER TABLE departments
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE employers
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE machines
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE positions
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE modules
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE assignments
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE attempts
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE content_items
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE content_item_media
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE module_media
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE questions
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE choices
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE module_versions
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE uploaded_files
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE department_module_policies
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE user_machines
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE machine_modules
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE whs_records
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;
ALTER TABLE audit_logs
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce',
  ALTER COLUMN tracey_tenant_id SET NOT NULL;

-- users.tracey_tenant_id stays nullable (Phase 2 contract); just install
-- the DEFAULT so Flask's CSV-import keeps working without code change.
ALTER TABLE users
  ALTER COLUMN tracey_tenant_id SET DEFAULT '7a055706-c2f4-4325-8631-2ddf42bfa6ce';

-- ---------------------------------------------------------------------------
-- 4. INDEXES.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS departments_tenant_idx               ON departments               (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS employers_tenant_idx                 ON employers                 (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS machines_tenant_idx                  ON machines                  (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS positions_tenant_idx                 ON positions                 (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS modules_tenant_idx                   ON modules                   (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS assignments_tenant_idx               ON assignments               (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS attempts_tenant_idx                  ON attempts                  (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS content_items_tenant_idx             ON content_items             (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS content_item_media_tenant_idx        ON content_item_media        (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS module_media_tenant_idx              ON module_media              (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS questions_tenant_idx                 ON questions                 (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS choices_tenant_idx                   ON choices                   (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS module_versions_tenant_idx           ON module_versions           (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS uploaded_files_tenant_idx            ON uploaded_files            (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS department_module_policies_tenant_idx ON department_module_policies (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS user_machines_tenant_idx             ON user_machines             (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS machine_modules_tenant_idx           ON machine_modules           (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS whs_records_tenant_idx               ON whs_records               (tracey_tenant_id);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_idx                ON audit_logs                (tracey_tenant_id);

COMMIT;

-- ---------------------------------------------------------------------------
-- 5. SANITY CHECKS — these are SELECTs you can re-run any time.
-- ---------------------------------------------------------------------------

-- Should return 0 for every row:
SELECT 'departments' AS t, count(*) AS null_rows FROM departments WHERE tracey_tenant_id IS NULL
UNION ALL SELECT 'modules',     count(*) FROM modules     WHERE tracey_tenant_id IS NULL
UNION ALL SELECT 'assignments', count(*) FROM assignments WHERE tracey_tenant_id IS NULL
UNION ALL SELECT 'attempts',    count(*) FROM attempts    WHERE tracey_tenant_id IS NULL
UNION ALL SELECT 'whs_records', count(*) FROM whs_records WHERE tracey_tenant_id IS NULL;

-- Should show one row per legacy table with the tenant id baked in as DEFAULT:
SELECT table_name, column_default
FROM information_schema.columns
WHERE column_name = 'tracey_tenant_id'
  AND table_schema = 'public'
ORDER BY table_name;
