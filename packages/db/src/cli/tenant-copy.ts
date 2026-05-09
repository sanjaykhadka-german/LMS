// Phase 7c — per-tenant data copy CLI.
//
// Copies a tenant's rows from public.lms_* into tenant_<uuid>.lms_*. The
// copy runs in ONE transaction with SET CONSTRAINTS ALL DEFERRED, then
// resyncs every per-tenant sequence so the next app-issued INSERT emits
// max(id)+1 rather than colliding with copied rows.
//
// COPY-ONLY. Reads `public.lms_*` (no mutation). Writes only to
// `tenant_<x>.lms_*`. The originals stay in place — Phase 7c never
// deletes or alters source rows.
//
// After the transaction commits, the CLI runs verification: per-table
// count match, sequence advance check, FK integrity smoke. Only on
// verification success is `0007_data_copy` recorded in app.tenant_migrations.
//
// Usage:
//   pnpm db:tenant-copy <tenant-uuid>
//   pnpm db:tenant-copy <tenant-uuid> --force
//
// --force re-runs after the operator has manually dropped the schema and
// re-provisioned it. Without --force, a tenant with `0007_data_copy` in
// the ledger refuses to re-copy.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  BASELINE_MIGRATION_NAME,
  DATA_COPY_MIGRATION_NAME,
  LMS_TABLES,
  LMS_TABLES_WITH_ID,
  dataCopySql,
  tenantSchemaName,
} from "../per-tenant-schema";
import { verifyTenantCopy } from "../per-tenant-verify";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
loadEnv({ path: path.resolve(repoRoot, ".env") });

async function main() {
  const tenantId = process.argv[2];
  const force = process.argv.includes("--force");
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    console.error("usage: pnpm db:tenant-copy <tenant-uuid> [--force]");
    process.exit(2);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[tenant-copy] DATABASE_URL is required");
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle(sql);

  // 1. Validate tenant exists.
  const tenantRows = (await db.execute(
    drizzleSql`SELECT slug FROM app.tenants WHERE id = ${tenantId} LIMIT 1`,
  )) as unknown as Array<{ slug: string }>;
  if (tenantRows.length === 0) {
    console.error(`[tenant-copy] tenant ${tenantId} not found in app.tenants`);
    await sql.end();
    process.exit(1);
  }
  const slug = tenantRows[0]!.slug;
  const schema = tenantSchemaName(tenantId);

  // 2. Validate baseline schema is in place.
  const ledger = (await db.execute(
    drizzleSql`SELECT migration_name FROM app.tenant_migrations WHERE tenant_id = ${tenantId}`,
  )) as unknown as Array<{ migration_name: string }>;
  const applied = new Set(ledger.map((r) => r.migration_name));

  if (!applied.has(BASELINE_MIGRATION_NAME)) {
    console.error(
      `[tenant-copy] tenant ${slug} has no per-tenant schema. Run pnpm db:tenant-provision ${tenantId} --force first.`,
    );
    await sql.end();
    process.exit(1);
  }

  // 3. Refuse re-runs unless --force.
  if (applied.has(DATA_COPY_MIGRATION_NAME) && !force) {
    console.error(
      `[tenant-copy] tenant ${slug} already has ${DATA_COPY_MIGRATION_NAME} in the ledger.\n` +
        `  Re-running would attempt INSERTs against a populated per-tenant schema and likely\n` +
        `  fail on PK conflicts. To re-copy:\n` +
        `    1) DROP SCHEMA "${schema}" CASCADE;\n` +
        `    2) DELETE FROM app.tenant_migrations WHERE tenant_id = '${tenantId}';\n` +
        `    3) pnpm db:tenant-provision ${tenantId} --force\n` +
        `    4) pnpm db:tenant-copy ${tenantId} --force`,
    );
    await sql.end();
    process.exit(1);
  }

  // 4. Run the copy.
  console.log(`[tenant-copy] tenant ${slug} (${tenantId})`);
  console.log(`[tenant-copy] target schema: ${schema}`);
  const stmts = dataCopySql(tenantId);
  console.log(`[tenant-copy] ${stmts.length} statements (incl. ${LMS_TABLES.length} INSERTs + ${LMS_TABLES_WITH_ID.length} setvals)`);

  await db.transaction(async (tx) => {
    for (const stmt of stmts) {
      await tx.execute(drizzleSql.raw(stmt));
    }
  });

  // 5. Verify.
  const result = await verifyTenantCopy(db, tenantId, schema);
  const totalCopied = result.perTable.reduce((acc, r) => acc + r.copy, 0);
  console.log(`[tenant-copy] copied ${totalCopied} rows across ${result.perTable.length} tables`);
  for (const r of result.perTable) {
    if (r.source > 0 || r.copy > 0) {
      const status = r.source === r.copy ? "ok" : "MISMATCH";
      console.log(`  ${r.table.padEnd(30)} source=${r.source.toString().padStart(6)} copy=${r.copy.toString().padStart(6)}  ${status}`);
    }
  }

  if (!result.ok) {
    console.error(`[tenant-copy] VERIFICATION FAILED:`);
    for (const e of result.errors) console.error(`  - ${e}`);
    console.error(
      `\n  Ledger NOT updated. Investigate, then either:\n` +
        `    a) DROP SCHEMA "${schema}" CASCADE; pnpm db:tenant-provision ${tenantId} --force; pnpm db:tenant-copy ${tenantId}\n` +
        `    b) Fix data in public.lms_* and re-run this CLI (it will see no ledger row and re-copy).`,
    );
    await sql.end();
    process.exit(1);
  }

  // 6. Record in ledger.
  await db.execute(
    drizzleSql`INSERT INTO app.tenant_migrations (tenant_id, migration_name) VALUES (${tenantId}, ${DATA_COPY_MIGRATION_NAME}) ON CONFLICT (tenant_id, migration_name) DO UPDATE SET applied_at = now()`,
  );

  console.log(`[tenant-copy] done — ${schema} populated and ledgered`);
  await sql.end();
}

main().catch((err) => {
  console.error("[tenant-copy] failed:", err);
  process.exit(1);
});
