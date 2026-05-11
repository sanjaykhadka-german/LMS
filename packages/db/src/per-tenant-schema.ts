// Phase 7a — single source of truth for the per-tenant LMS DDL.
//
// `provisionTenant(tenantId)` (in apps/lms-web/lib/tenancy/provision.ts)
// runs the SQL produced here inside one transaction. The shape was driven
// by the audit at the top of the Phase 7 plan:
//   - Every table uses old-style `nextval('xxx_id_seq')` defaults, NOT
//     IDENTITY columns. `LIKE INCLUDING ALL` would silently share the
//     `public.<table>_id_seq` across tenants, so we explicitly create new
//     sequences per tenant and rewrite the column DEFAULT.
//   - There are zero triggers on the 19 LMS tables — nothing to recreate.
//   - There are 26 FKs across the 19 tables. `LIKE` does not copy FKs at
//     all (Postgres docs: "Foreign key constraints are not retained").
//     We declare them explicitly here, schema-qualified:
//       * Within-LMS FKs (14) point at the per-tenant schema's tables.
//       * FKs to lms_users (12) point at `public.users` — that table
//         stays in `public` permanently for the legacy auth bridge.
//   - The `tracey_tenant_id` column DEFAULT in 0003_lms_multitenant.sql is
//     hardcoded to a single tenant UUID. We override it per tenant. RLS
//     would catch a cross-tenant write anyway; this is belt-and-braces.
//   - RLS is enabled inside the per-tenant schema with the same
//     `tenant_isolation` policy keyed on `current_setting('app.tenant_id')`.
//     This is defence-in-depth: physical schema isolation is the primary
//     guarantee, RLS is a backstop.
//
// Single role today (root on local; the Render-managed user in prod), so
// GRANTs are no-ops — the schema and tables are owned by the connection
// role, which already has full access. If a separate app role is added
// later, GRANT statements get added to `appendGrantsSql(tenantId, role)`.

export const LMS_TABLES_WITH_ID = [
  "departments",
  "employers",
  "machines",
  "positions",
  "modules",
  "module_versions",
  "content_items",
  "content_item_media",
  "module_media",
  "questions",
  "choices",
  "assignments",
  "attempts",
  "audit_logs",
  "whs_records",
  "whs_kinds",
  "department_module_policies",
] as const;

const LMS_TABLES_NO_ID = [
  // Composite-PK or filename-PK tables — no own sequence.
  "user_machines",
  "machine_modules",
  "uploaded_files",
] as const;

export const LMS_TABLES = [...LMS_TABLES_WITH_ID, ...LMS_TABLES_NO_ID] as const;

interface FkSpec {
  table: string; // child table (will be created in tenant schema)
  constraintName: string;
  column: string;
  refTable: string; // parent table
  refColumn: string;
  refSchema: "tenant" | "public"; // "tenant" → use tenant schema, "public" → keep cross-tenant
  onDelete?: "CASCADE" | "SET NULL"; // omitted = NO ACTION
}

// Mirror of the 26 FKs reported by `pg_constraint` for the LMS tables.
// `refSchema: "public"` is used for FKs that target `lms_users` (mapped to
// `public.users`) — that table stays in `public` for the legacy auth
// bridge. Everything else is within-LMS and lives per-tenant.
const FKS: FkSpec[] = [
  // assignments
  { table: "assignments", constraintName: "assignments_module_id_fkey", column: "module_id", refTable: "modules", refColumn: "id", refSchema: "tenant" },
  { table: "assignments", constraintName: "assignments_user_id_fkey", column: "user_id", refTable: "users", refColumn: "id", refSchema: "public" },
  { table: "assignments", constraintName: "assignments_version_id_fkey", column: "version_id", refTable: "module_versions", refColumn: "id", refSchema: "tenant" },

  // attempts
  { table: "attempts", constraintName: "attempts_module_id_fkey", column: "module_id", refTable: "modules", refColumn: "id", refSchema: "tenant" },
  { table: "attempts", constraintName: "attempts_user_id_fkey", column: "user_id", refTable: "users", refColumn: "id", refSchema: "public" },

  // audit_logs
  { table: "audit_logs", constraintName: "audit_logs_user_id_fkey", column: "user_id", refTable: "users", refColumn: "id", refSchema: "public", onDelete: "SET NULL" },

  // choices
  { table: "choices", constraintName: "choices_question_id_fkey", column: "question_id", refTable: "questions", refColumn: "id", refSchema: "tenant" },

  // content_item_media
  { table: "content_item_media", constraintName: "content_item_media_content_item_id_fkey", column: "content_item_id", refTable: "content_items", refColumn: "id", refSchema: "tenant" },

  // content_items
  { table: "content_items", constraintName: "content_items_module_id_fkey", column: "module_id", refTable: "modules", refColumn: "id", refSchema: "tenant" },

  // department_module_policies
  { table: "department_module_policies", constraintName: "department_module_policies_department_id_fkey", column: "department_id", refTable: "departments", refColumn: "id", refSchema: "tenant", onDelete: "CASCADE" },
  { table: "department_module_policies", constraintName: "department_module_policies_module_id_fkey", column: "module_id", refTable: "modules", refColumn: "id", refSchema: "tenant", onDelete: "CASCADE" },

  // machine_modules
  { table: "machine_modules", constraintName: "machine_modules_machine_id_fkey", column: "machine_id", refTable: "machines", refColumn: "id", refSchema: "tenant", onDelete: "CASCADE" },
  { table: "machine_modules", constraintName: "machine_modules_module_id_fkey", column: "module_id", refTable: "modules", refColumn: "id", refSchema: "tenant", onDelete: "CASCADE" },

  // machines
  { table: "machines", constraintName: "machines_department_id_fkey", column: "department_id", refTable: "departments", refColumn: "id", refSchema: "tenant" },

  // module_media
  { table: "module_media", constraintName: "module_media_module_id_fkey", column: "module_id", refTable: "modules", refColumn: "id", refSchema: "tenant" },

  // module_versions
  { table: "module_versions", constraintName: "module_versions_created_by_id_fkey", column: "created_by_id", refTable: "users", refColumn: "id", refSchema: "public" },
  { table: "module_versions", constraintName: "module_versions_module_id_fkey", column: "module_id", refTable: "modules", refColumn: "id", refSchema: "tenant" },

  // modules
  { table: "modules", constraintName: "modules_created_by_id_fkey", column: "created_by_id", refTable: "users", refColumn: "id", refSchema: "public" },

  // positions
  { table: "positions", constraintName: "positions_department_id_fkey", column: "department_id", refTable: "departments", refColumn: "id", refSchema: "tenant" },
  { table: "positions", constraintName: "positions_parent_id_fkey", column: "parent_id", refTable: "positions", refColumn: "id", refSchema: "tenant", onDelete: "SET NULL" },

  // questions
  { table: "questions", constraintName: "questions_module_id_fkey", column: "module_id", refTable: "modules", refColumn: "id", refSchema: "tenant" },

  // uploaded_files
  { table: "uploaded_files", constraintName: "uploaded_files_uploaded_by_id_fkey", column: "uploaded_by_id", refTable: "users", refColumn: "id", refSchema: "public" },

  // user_machines
  { table: "user_machines", constraintName: "user_machines_machine_id_fkey", column: "machine_id", refTable: "machines", refColumn: "id", refSchema: "tenant", onDelete: "CASCADE" },
  { table: "user_machines", constraintName: "user_machines_user_id_fkey", column: "user_id", refTable: "users", refColumn: "id", refSchema: "public", onDelete: "CASCADE" },

  // whs_records
  { table: "whs_records", constraintName: "whs_records_reported_by_id_fkey", column: "reported_by_id", refTable: "users", refColumn: "id", refSchema: "public", onDelete: "SET NULL" },
  { table: "whs_records", constraintName: "whs_records_user_id_fkey", column: "user_id", refTable: "users", refColumn: "id", refSchema: "public", onDelete: "SET NULL" },
];

const SCHEMA_PREFIX = "tenant_";

export function tenantSchemaName(tenantId: string): string {
  // Quoted identifier handles the dashes in the UUID. `tenant_` prefix
  // distinguishes per-tenant schemas from `app` and `public` for
  // pg_namespace enumeration in /platform views (Phase 7d).
  return `${SCHEMA_PREFIX}${tenantId}`;
}

export function isTenantSchemaName(name: string): boolean {
  return name.startsWith(SCHEMA_PREFIX);
}

function q(ident: string): string {
  // Double-quote and escape any embedded quotes. Used for schema/table
  // names. Tenant UUIDs always have dashes, so quoting is mandatory.
  return `"${ident.replace(/"/g, '""')}"`;
}

function lit(value: string): string {
  // Single-quoted SQL literal with embedded quotes escaped.
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Returns the ordered list of SQL statements that build a fresh per-tenant
 * schema for `tenantId`. Every statement is independently idempotent or
 * the whole sequence runs inside a single transaction (provisionTenant);
 * either way, re-running on an already-provisioned tenant is safe.
 */
export function provisionSql(tenantId: string): string[] {
  const schema = tenantSchemaName(tenantId);
  const qSchema = q(schema);
  const stmts: string[] = [];

  // 1. Schema itself.
  stmts.push(`CREATE SCHEMA IF NOT EXISTS ${qSchema}`);

  // 2. Tables — `LIKE … INCLUDING ALL` brings indexes, defaults, CHECK
  //    constraints, comments. It does NOT bring FKs (handled in step 5)
  //    and it does NOT auto-create new sequences for serial-style id
  //    columns (handled in step 3).
  for (const table of LMS_TABLES) {
    stmts.push(
      `CREATE TABLE IF NOT EXISTS ${qSchema}.${q(table)} (LIKE public.${q(table)} INCLUDING ALL)`,
    );
  }

  // 3. Per-tenant sequences for the 16 tables with an `id` column.
  //    `LIKE` copied the column DEFAULT verbatim — `nextval('public.xxx_id_seq')` —
  //    which would silently share the sequence across tenants. Override.
  for (const table of LMS_TABLES_WITH_ID) {
    const seqName = `${table}_id_seq`;
    stmts.push(`CREATE SEQUENCE IF NOT EXISTS ${qSchema}.${q(seqName)}`);
    stmts.push(
      `ALTER TABLE ${qSchema}.${q(table)} ALTER COLUMN id SET DEFAULT nextval(${lit(`${schema}.${seqName}`)}::regclass)`,
    );
    stmts.push(
      `ALTER SEQUENCE ${qSchema}.${q(seqName)} OWNED BY ${qSchema}.${q(table)}.id`,
    );
  }

  // 4. Override `tracey_tenant_id` DEFAULT (0003 baked the GB UUID).
  for (const table of LMS_TABLES) {
    stmts.push(
      `ALTER TABLE ${qSchema}.${q(table)} ALTER COLUMN tracey_tenant_id SET DEFAULT ${lit(tenantId)}`,
    );
  }

  // 5. FKs — recreate explicitly. Within-LMS FKs point at this tenant's
  //    schema; FKs to lms_users point at public.users (legacy bridge home).
  //    DEFERRABLE INITIALLY IMMEDIATE so the future Phase 7c data copy can
  //    flip on `SET CONSTRAINTS ALL DEFERRED` for bulk INSERT-FROM-SELECT.
  for (const fk of FKS) {
    const refQualified =
      fk.refSchema === "tenant"
        ? `${qSchema}.${q(fk.refTable)}`
        : `public.${q(fk.refTable)}`;
    const onDelete = fk.onDelete ? ` ON DELETE ${fk.onDelete}` : "";
    stmts.push(
      `ALTER TABLE ${qSchema}.${q(fk.table)} ` +
        `ADD CONSTRAINT ${q(fk.constraintName)} ` +
        `FOREIGN KEY (${q(fk.column)}) ` +
        `REFERENCES ${refQualified}(${q(fk.refColumn)})${onDelete} ` +
        `DEFERRABLE INITIALLY IMMEDIATE`,
    );
  }

  // 6. RLS inside the per-tenant schema — defence-in-depth on top of
  //    physical schema isolation. Same policy shape as 0004_enable_rls.sql.
  for (const table of LMS_TABLES) {
    stmts.push(`ALTER TABLE ${qSchema}.${q(table)} ENABLE ROW LEVEL SECURITY`);
    stmts.push(`ALTER TABLE ${qSchema}.${q(table)} FORCE ROW LEVEL SECURITY`);
    stmts.push(
      `DROP POLICY IF EXISTS tenant_isolation ON ${qSchema}.${q(table)}`,
    );
    stmts.push(
      `CREATE POLICY tenant_isolation ON ${qSchema}.${q(table)} ` +
        `USING (tracey_tenant_id = current_setting('app.tenant_id', true)) ` +
        `WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true))`,
    );
  }

  return stmts;
}

/**
 * Idempotency probe — `provisionTenant()` calls this first to short-circuit
 * if the schema already exists. Cheaper than running CREATE-IF-NOT-EXISTS
 * across ~80 statements and produces a cleaner audit trail.
 */
export const SCHEMA_EXISTS_SQL = `SELECT 1 FROM pg_namespace WHERE nspname = $1`;

/**
 * Marker name written to `app.tenant_migrations` once provisioning succeeds.
 * Any future per-tenant DDL change ships under a new migration_name and is
 * applied by per-tenant-migrate.ts, ledgered separately.
 */
export const BASELINE_MIGRATION_NAME = "0006_baseline";

/** Phase 7c — written when `tenant-copy` succeeds. Re-running copy is
 *  refused unless the operator passes --force (and manually drops the
 *  schema first). */
export const DATA_COPY_MIGRATION_NAME = "0007_data_copy";

/** Phase 7c — written when `tenant-freeze` succeeds (REVOKE on public.lms_*).
 *  Removed by `tenant-unfreeze`. */
export const FREEZE_MIGRATION_NAME = "0008_freeze";

/**
 * Phase 7c — INSERT-FROM-SELECT for the tenant's data, plus sequence resync.
 * Returns an ordered list of SQL statements meant to be executed inside ONE
 * transaction. Run order:
 *
 *   1. SET LOCAL search_path = "tenant_<x>", public  (so unqualified names
 *      resolve to the per-tenant schema first; the source SELECT uses
 *      explicit `public.<table>` to bypass the per-tenant resolution).
 *   2. SET CONSTRAINTS ALL DEFERRED  (the FKs created by provisionSql() are
 *      DEFERRABLE INITIALLY IMMEDIATE; deferring them lets the 19 INSERTs
 *      run in any order without intermediate FK violations).
 *   3. INSERT INTO "tenant_<x>"."<table>" SELECT * FROM public."<table>"
 *      WHERE tracey_tenant_id = '<id>'   (one per LMS_TABLES; 19 total).
 *   4. setval each per-tenant sequence to MAX(id) of the now-populated
 *      table, with `is_called` = (rows existed) so the next nextval emits
 *      max+1 (or 1 if empty). Postgres-safe even for empty source.
 *
 * Reads from `public` are non-mutating; the `public.lms_*` rows are not
 * modified by this SQL. Writes go only to `tenant_<x>.lms_*`.
 */
export function dataCopySql(tenantId: string): string[] {
  const schema = tenantSchemaName(tenantId);
  const qSchema = q(schema);
  const stmts: string[] = [];

  // Set app.tenant_id so the RLS policies on public.lms_* (0004_enable_rls.sql)
  // and on tenant_<x>.lms_* (provisionSql) admit this tenant's rows. Without
  // this, every `INSERT … SELECT FROM public.<t> WHERE tracey_tenant_id = $1`
  // sees zero rows, the copy silently no-ops, and verify() falsely passes
  // (source=0 vs copy=0). Tx-local — cleared on commit.
  stmts.push(`SELECT set_config('app.tenant_id', ${lit(tenantId)}, true)`);

  // Search path needs the tenant schema first so unqualified `id` etc.
  // resolve correctly; the SELECT side uses fully qualified `public.<t>`
  // to read the source.
  stmts.push(`SET LOCAL search_path = ${qSchema}, public`);

  // Defer FK validation to commit so we can INSERT in any order.
  stmts.push(`SET CONSTRAINTS ALL DEFERRED`);

  // Copy each table.
  for (const table of LMS_TABLES) {
    stmts.push(
      `INSERT INTO ${qSchema}.${q(table)} ` +
        `SELECT * FROM public.${q(table)} ` +
        `WHERE tracey_tenant_id = ${lit(tenantId)}`,
    );
  }

  // Sequence resync — only ID-bearing tables.
  for (const table of LMS_TABLES_WITH_ID) {
    const seqName = `${table}_id_seq`;
    const seqQualified = `${schema}.${seqName}`;
    // setval(seq, value, is_called):
    //   - value: MAX(id) if rows exist, else 1.
    //   - is_called: true if rows exist (next nextval = max+1),
    //                false if empty (next nextval = 1).
    // GREATEST(1, ...) protects setval from receiving 0 or negative.
    stmts.push(
      `SELECT setval(${lit(seqQualified)}, ` +
        `GREATEST(1, COALESCE((SELECT MAX(id) FROM ${qSchema}.${q(table)}), 1)), ` +
        `(SELECT MAX(id) IS NOT NULL FROM ${qSchema}.${q(table)}))`,
    );
  }

  return stmts;
}

/**
 * Phase 7c — adds a `CHECK (false) NOT VALID` constraint to every
 * public.lms_* table. After the constraint is in place:
 *   - Existing rows are not re-validated (NOT VALID skip), so the
 *     frozen snapshot stays intact.
 *   - INSERT and UPDATE fail with a CHECK violation — the row would not
 *     satisfy `false`, and constraint validation catches it.
 *   - SELECT and DELETE are unaffected.
 *
 * Why CHECK and not REVOKE: the connection role on this codebase is the
 * table owner (root locally, the Render-managed user in prod). Postgres
 * grants owners implicit ALL privileges that REVOKE cannot remove. CHECK
 * constraints apply to all roles, including owners.
 *
 * Inverse: `unfreezeSql()` drops the constraint.
 */
export const FREEZE_CONSTRAINT_NAME = "phase7c_frozen";

export function freezeSql(): string[] {
  const stmts: string[] = [];
  for (const table of LMS_TABLES) {
    stmts.push(
      `ALTER TABLE public.${q(table)} ADD CONSTRAINT ${q(FREEZE_CONSTRAINT_NAME)} CHECK (false) NOT VALID`,
    );
  }
  return stmts;
}

/** Phase 7c — inverse of `freezeSql()`. Drops the freeze constraint. */
export function unfreezeSql(): string[] {
  const stmts: string[] = [];
  for (const table of LMS_TABLES) {
    stmts.push(
      `ALTER TABLE public.${q(table)} DROP CONSTRAINT IF EXISTS ${q(FREEZE_CONSTRAINT_NAME)}`,
    );
  }
  return stmts;
}
