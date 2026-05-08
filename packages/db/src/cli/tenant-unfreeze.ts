// Phase 7c — public.lms_* unfreeze CLI.
//
// Inverse of tenant-freeze: drops the `phase7c_frozen` CHECK constraint
// from every public.lms_* table, and removes the `0008_freeze` row from
// app.tenant_migrations. After unfreeze, INSERTs/UPDATEs on public.lms_*
// succeed again — primarily useful for rollback during the soak period
// after a freeze.
//
// Usage:
//   pnpm db:tenant-unfreeze <tenant-uuid>
//
// Idempotent: tenants without `0008_freeze` in the ledger exit with a
// no-op message (the GRANTs are still issued for safety, but they're
// already in place so it's a no-op at the DB level too).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { FREEZE_MIGRATION_NAME, unfreezeSql } from "../per-tenant-schema";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
loadEnv({ path: path.resolve(repoRoot, ".env") });

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    console.error("usage: pnpm db:tenant-unfreeze <tenant-uuid>");
    process.exit(2);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[tenant-unfreeze] DATABASE_URL is required");
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle(sql);

  const tenantRows = (await db.execute(
    drizzleSql`SELECT slug FROM app.tenants WHERE id = ${tenantId} LIMIT 1`,
  )) as unknown as Array<{ slug: string }>;
  if (tenantRows.length === 0) {
    console.error(`[tenant-unfreeze] tenant ${tenantId} not found in app.tenants`);
    await sql.end();
    process.exit(1);
  }
  const slug = tenantRows[0]!.slug;

  const ledger = (await db.execute(
    drizzleSql`SELECT 1 FROM app.tenant_migrations WHERE tenant_id = ${tenantId} AND migration_name = ${FREEZE_MIGRATION_NAME} LIMIT 1`,
  )) as unknown as Array<{ "?column?": number }>;
  const wasFrozen = ledger.length > 0;

  if (!wasFrozen) {
    console.log(
      `[tenant-unfreeze] tenant ${slug} not in ledger as frozen — issuing GRANTs anyway as a safety net`,
    );
  }

  const stmts = unfreezeSql();
  console.log(`[tenant-unfreeze] tenant ${slug} (${tenantId})`);
  console.log(`[tenant-unfreeze] dropping CHECK (false) constraint on ${stmts.length} public.lms_* tables`);

  await db.transaction(async (tx) => {
    for (const stmt of stmts) {
      await tx.execute(drizzleSql.raw(stmt));
    }
    if (wasFrozen) {
      await tx.execute(
        drizzleSql`DELETE FROM app.tenant_migrations WHERE tenant_id = ${tenantId} AND migration_name = ${FREEZE_MIGRATION_NAME}`,
      );
    }
  });

  console.log(`[tenant-unfreeze] done — public.lms_* writes restored`);
  await sql.end();
}

main().catch((err) => {
  console.error("[tenant-unfreeze] failed:", err);
  process.exit(1);
});
