-- ShiftCraft per-tenant — sc_departments + sc_employees.department_id.
--
-- Promotes the existing sc_employees.department text column into its own
-- table so Reports can group by department FK. Backfills existing rows
-- before dropping the text column so no data is lost.

-- 1. New table.
CREATE TABLE IF NOT EXISTS sc_departments (LIKE public.sc_departments INCLUDING ALL);

-- 2. Tenant default + RLS for sc_departments.
ALTER TABLE sc_departments ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_departments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_departments;
CREATE POLICY tenant_isolation ON sc_departments
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- 3. Add the FK column to sc_employees. Nullable so existing rows survive
--    the migration; the backfill below populates it where we have a text
--    value to match.
ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS department_id uuid;

-- 4. Backfill. For each distinct non-blank department text on
--    sc_employees, insert a sc_departments row (case-insensitive dedupe
--    via the unique index), then UPDATE the employee row to point at it.
--    Run inside one transaction (provided by the migration runner) so a
--    failure mid-backfill rolls back cleanly.
--
--    Guarded by a column-existence check: fresh per-tenant copies created
--    from the current public.sc_employees template (post-rename) don't have
--    a `department` text column to backfill from. Wrapping the legacy SQL
--    in EXECUTE defers parsing to runtime, so the column reference doesn't
--    fail when the IF branch is skipped.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'sc_employees'
      AND column_name = 'department'
  ) THEN
    EXECUTE $sql$
      INSERT INTO sc_departments (tracey_tenant_id, name)
      SELECT DISTINCT
        current_setting('app.tenant_id', true),
        trim(department)
      FROM sc_employees
      WHERE department IS NOT NULL
        AND trim(department) <> ''
      ON CONFLICT (tracey_tenant_id, lower(name)) DO NOTHING
    $sql$;

    EXECUTE $sql$
      UPDATE sc_employees e
      SET department_id = d.id
      FROM sc_departments d
      WHERE e.department_id IS NULL
        AND e.department IS NOT NULL
        AND trim(e.department) <> ''
        AND lower(trim(e.department)) = lower(d.name)
        AND d.tracey_tenant_id = current_setting('app.tenant_id', true)
    $sql$;
  END IF;
END $$;

-- 5. FK on the new column, pointing at the per-tenant sc_departments.
ALTER TABLE sc_employees
  ADD CONSTRAINT sc_employees_department_id_fkey
  FOREIGN KEY (department_id) REFERENCES sc_departments(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- 6. Drop the old text column now that values are migrated. Cascade in
--    case a downstream constraint depends on it.
ALTER TABLE sc_employees DROP COLUMN IF EXISTS department CASCADE;
