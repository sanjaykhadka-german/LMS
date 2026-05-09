// Phase 7b — retroactive tenant-provision CLI.
//
// Calls provisionTenant() against an existing app.tenants row, creating
// the tenant_<uuid> schema with the baseline DDL. Idempotent — re-running
// against an already-provisioned tenant exits with a no-op message.
//
// SCHEMA ONLY. Does NOT copy any existing public.lms_* data into the new
// schema. That's Phase 7c. After this CLI runs, the tenant has both:
//   - public.lms_* rows (existing, untouched)
//   - tenant_<uuid>.lms_* tables (new, empty)
//
// Until 7c does the data copy, the application's forTenant() routes
// queries via search_path which finds the empty per-tenant tables FIRST
// (not the public ones). So running this CLI on a tenant that already
// has data in public effectively HIDES that data from the app — until
// 7c moves it. ONLY safe to use on:
//   - Brand-new tenants signed up with the flag off (no LMS data yet), or
//   - Sandbox / test tenants you're about to load fresh data into.
//
// Refuses to provision a tenant that has existing rows in any LMS table
// in public, unless --force is passed.
//
// Usage:
//   pnpm db:tenant-provision <tenant-uuid>
//   pnpm db:tenant-provision <tenant-uuid> --force

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  BASELINE_MIGRATION_NAME,
  provisionSql,
  tenantSchemaName,
} from "../per-tenant-schema";
import { findExistingTenantRowsInPublic } from "../per-tenant-verify";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
loadEnv({ path: path.resolve(repoRoot, ".env") });

async function main() {
  const tenantId = process.argv[2];
  const force = process.argv.includes("--force");
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    console.error("usage: pnpm db:tenant-provision <tenant-uuid> [--force]");
    process.exit(2);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[tenant-provision] DATABASE_URL is required");
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle(sql);

  const tenantRows = (await db.execute(
    drizzleSql`SELECT slug, name FROM app.tenants WHERE id = ${tenantId} LIMIT 1`,
  )) as unknown as Array<{ slug: string; name: string }>;
  if (tenantRows.length === 0) {
    console.error(`[tenant-provision] tenant ${tenantId} not found in app.tenants`);
    await sql.end();
    process.exit(1);
  }
  const tenant = tenantRows[0]!;

  // Idempotency check via the ledger. Skip if already baselined.
  const ledger = (await db.execute(
    drizzleSql`SELECT 1 FROM app.tenant_migrations WHERE tenant_id = ${tenantId} AND migration_name = ${BASELINE_MIGRATION_NAME} LIMIT 1`,
  )) as unknown as Array<{ "?column?": number }>;
  if (ledger.length > 0) {
    console.log(`[tenant-provision] tenant ${tenant.slug} already baselined — nothing to do`);
    await sql.end();
    return;
  }

  // Safety check: refuse to provision if the tenant has existing rows in
  // any LMS table in public — provisioning would shadow the existing data
  // until 7c does the copy. --force overrides for sandbox use. Logic
  // extracted to per-tenant-verify so the regression test in
  // tests/per-tenant-rls.test.ts can exercise it directly.
  if (!force) {
    const offender = await findExistingTenantRowsInPublic(db, tenantId);
    if (offender) {
      console.error(
        `[tenant-provision] REFUSING — tenant ${tenant.slug} has ${offender.count} rows in public.${offender.table}.\n` +
          `  Provisioning a per-tenant schema would HIDE this data from the app until Phase 7c copies it over.\n` +
          `  Either:\n` +
          `    a) wait for Phase 7c to handle the data copy + provisioning together, or\n` +
          `    b) re-run with --force if you intend to provision a sandbox tenant whose data is meant to be empty.`,
      );
      await sql.end();
      process.exit(1);
    }
  }

  const schema = tenantSchemaName(tenantId);
  const stmts = provisionSql(tenantId);

  console.log(`[tenant-provision] tenant ${tenant.slug} (${tenantId})`);
  console.log(`[tenant-provision] creating schema: ${schema}`);
  console.log(`[tenant-provision] ${stmts.length} statements`);

  await db.transaction(async (tx) => {
    for (const stmt of stmts) {
      await tx.execute(drizzleSql.raw(stmt));
    }
    await tx.execute(
      drizzleSql`INSERT INTO app.tenant_migrations (tenant_id, migration_name) VALUES (${tenantId}, ${BASELINE_MIGRATION_NAME}) ON CONFLICT DO NOTHING`,
    );
  });

  console.log(`[tenant-provision] done — ${schema} provisioned`);
  await sql.end();
}

main().catch((err) => {
  console.error("[tenant-provision] failed:", err);
  process.exit(1);
});
