// Phase 7c — public.lms_* freeze CLI.
//
// Adds a `CHECK (false) NOT VALID` constraint to every public.lms_*
// table. After freeze, any accidental fall-through INSERT/UPDATE on
// public.lms_* via search_path resolution fails loudly with a CHECK
// violation. SELECT and DELETE remain functional. Existing rows are
// preserved (NOT VALID skips re-validation).
//
// Why CHECK and not REVOKE: the connection role on this codebase is the
// table owner. Postgres grants owners implicit ALL privileges that
// REVOKE cannot remove. CHECK constraints apply to all roles uniformly.
//
// The `<tenant-id>` argument is for ledger bookkeeping — operators run
// this AFTER every logical tenant has been copied to its own per-tenant
// schema. Validates the named tenant has `0007_data_copy` in the ledger
// before freezing.
//
// Inverse: `pnpm db:tenant-unfreeze <id>` re-grants writes.
//
// Usage:
//   pnpm db:tenant-freeze <tenant-uuid>
//
// Refuses if the tenant has not been copied (no `0007_data_copy` in the
// ledger) — freezing public before the data is safely in the per-tenant
// schema would break the app.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  DATA_COPY_MIGRATION_NAME,
  FREEZE_MIGRATION_NAME,
  freezeSql,
} from "../per-tenant-schema";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
loadEnv({ path: path.resolve(repoRoot, ".env") });

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    console.error("usage: pnpm db:tenant-freeze <tenant-uuid>");
    process.exit(2);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[tenant-freeze] DATABASE_URL is required");
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle(sql);

  const tenantRows = (await db.execute(
    drizzleSql`SELECT slug FROM app.tenants WHERE id = ${tenantId} LIMIT 1`,
  )) as unknown as Array<{ slug: string }>;
  if (tenantRows.length === 0) {
    console.error(`[tenant-freeze] tenant ${tenantId} not found in app.tenants`);
    await sql.end();
    process.exit(1);
  }
  const slug = tenantRows[0]!.slug;

  const ledger = (await db.execute(
    drizzleSql`SELECT migration_name FROM app.tenant_migrations WHERE tenant_id = ${tenantId}`,
  )) as unknown as Array<{ migration_name: string }>;
  const applied = new Set(ledger.map((r) => r.migration_name));

  if (!applied.has(DATA_COPY_MIGRATION_NAME)) {
    console.error(
      `[tenant-freeze] REFUSING — tenant ${slug} has no ${DATA_COPY_MIGRATION_NAME} in ledger.\n` +
        `  Freezing public.lms_* before data is safely in the per-tenant schema would break the app.\n` +
        `  Run pnpm db:tenant-copy ${tenantId} first.`,
    );
    await sql.end();
    process.exit(1);
  }

  if (applied.has(FREEZE_MIGRATION_NAME)) {
    console.log(`[tenant-freeze] tenant ${slug} already frozen — nothing to do`);
    await sql.end();
    return;
  }

  const stmts = freezeSql();
  console.log(`[tenant-freeze] tenant ${slug} (${tenantId})`);
  console.log(`[tenant-freeze] adding CHECK (false) constraint to ${stmts.length} public.lms_* tables`);

  await db.transaction(async (tx) => {
    for (const stmt of stmts) {
      await tx.execute(drizzleSql.raw(stmt));
    }
    await tx.execute(
      drizzleSql`INSERT INTO app.tenant_migrations (tenant_id, migration_name) VALUES (${tenantId}, ${FREEZE_MIGRATION_NAME}) ON CONFLICT DO NOTHING`,
    );
  });

  console.log(
    `[tenant-freeze] done — public.lms_* INSERTs/UPDATEs will now error with CHECK violation. ` +
      `Use pnpm db:tenant-unfreeze ${tenantId} to roll back.`,
  );
  await sql.end();
}

main().catch((err) => {
  console.error("[tenant-freeze] failed:", err);
  process.exit(1);
});
