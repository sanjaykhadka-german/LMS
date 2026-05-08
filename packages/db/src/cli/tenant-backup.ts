// Phase 7b — per-tenant backup CLI.
//
// Wraps `pg_dump --schema=tenant_<uuid>` and writes a timestamped .sql file
// to `<repo>/backups/`. Read-only on the database; the only write is the
// new file on the local filesystem.
//
// Usage:
//   pnpm db:tenant-backup <tenant-uuid>
//   pnpm db:tenant-backup add6df90-8039-407b-8782-906f0bc8060d
//
// Locates pg_dump via:
//   1. PG_DUMP_PATH env var (explicit override),
//   2. PATH lookup (`pg_dump` / `pg_dump.exe`),
//   3. Windows fallback: C:\Program Files\PostgreSQL\18\bin\pg_dump.exe.
//
// Required prereq for Phase 7c (need to back up GB before any data copy).
// Validates the schema actually exists before attempting pg_dump so a
// "logical" (no per-tenant schema) tenant exits with a clear message
// instead of an empty-but-confusing dump file.

import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { tenantSchemaName } from "../per-tenant-schema";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
loadEnv({ path: path.resolve(repoRoot, ".env") });

const WIN_PG_DUMP_FALLBACKS = [
  "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe",
  "C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe",
  "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe",
];

function locatePgDump(): string {
  if (process.env.PG_DUMP_PATH) return process.env.PG_DUMP_PATH;
  if (process.platform === "win32") {
    for (const candidate of WIN_PG_DUMP_FALLBACKS) {
      if (existsSync(candidate)) return candidate;
    }
  }
  // Trust PATH — spawn() will surface a clear ENOENT if not present.
  return process.platform === "win32" ? "pg_dump.exe" : "pg_dump";
}

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    console.error("usage: pnpm db:tenant-backup <tenant-uuid>");
    process.exit(2);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[tenant-backup] DATABASE_URL is required");
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle(sql);

  // Validate the tenant exists.
  const tenantRows = (await db.execute(
    drizzleSql`SELECT slug, name FROM app.tenants WHERE id = ${tenantId} LIMIT 1`,
  )) as unknown as Array<{ slug: string; name: string }>;
  if (tenantRows.length === 0) {
    console.error(`[tenant-backup] tenant ${tenantId} not found in app.tenants`);
    await sql.end();
    process.exit(1);
  }
  const tenant = tenantRows[0]!;

  const schema = tenantSchemaName(tenantId);

  // Validate the schema actually exists — a "logical" tenant has no
  // per-tenant schema yet, and pg_dumping a non-existent schema produces
  // a confusing empty dump. Bail clearly instead.
  const schemaRows = (await db.execute(
    drizzleSql`SELECT 1 FROM pg_namespace WHERE nspname = ${schema} LIMIT 1`,
  )) as unknown as Array<{ "?column?": number }>;
  if (schemaRows.length === 0) {
    console.error(
      `[tenant-backup] schema ${schema} does not exist (tenant ${tenant.slug} is logical, not provisioned). ` +
        `Use pnpm db:tenant-provision ${tenantId} first if you want a per-tenant schema.`,
    );
    await sql.end();
    process.exit(1);
  }

  await sql.end();

  // Filesystem prep: <repo>/backups/<tenant-uuid>_<ISO>.sql
  const backupsDir = path.resolve(repoRoot, "backups");
  await fs.mkdir(backupsDir, { recursive: true });
  const isoStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(backupsDir, `${schema}_${isoStamp}.sql`);

  // Spawn pg_dump. We pass DATABASE_URL via env (PGURL-equivalent) and
  // --schema to scope to the per-tenant schema. --no-owner / --no-privileges
  // keep the dump portable across environments (no role-specific output).
  //
  // --enable-row-security: pg_dump's default is to issue `SET row_security = off`
  // and refuse to dump if RLS policies would filter the result, because a
  // superuser run wants the unfiltered table. Our connection role is not a
  // superuser on prod, and the per-tenant tables have FORCE RLS enabled by
  // provisionSql. Without this flag, pg_dump bails on the first RLS-protected
  // table ("query would be affected by row-level security policy"). With this
  // flag plus PGOPTIONS=-c app.tenant_id=<id> below, pg_dump runs with
  // row_security=on and the tenant's GUC, so policies admit exactly the
  // tenant's rows — which is the entire intended dump anyway.
  const pgDump = locatePgDump();
  const args = [
    `--schema=${schema}`,
    "--no-owner",
    "--no-privileges",
    "--enable-row-security",
    "--format=plain",
    `--file=${outputPath}`,
    databaseUrl,
  ];

  console.log(`[tenant-backup] tenant ${tenant.slug} (${tenantId})`);
  console.log(`[tenant-backup] schema: ${schema}`);
  console.log(`[tenant-backup] pg_dump: ${pgDump}`);
  console.log(`[tenant-backup] output: ${outputPath}`);

  // PGOPTIONS sets `app.tenant_id` on pg_dump's libpq connection at startup,
  // so the RLS policies on tenant_<x>.lms_* (added by provisionSql) admit this
  // tenant's rows. Without this, pg_dump's COPY TO stdout fails with
  // "query would be affected by row-level security policy" on the first
  // RLS-protected table (e.g. assignments). The role used by the CLI is not
  // a superuser on prod, so RLS bites. Tx-local doesn't apply here — pg_dump
  // opens its own connection and is not part of our application transaction.
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(pgDump, args, {
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        PGOPTIONS: `${process.env.PGOPTIONS ?? ""} -c app.tenant_id=${tenantId}`.trim(),
      },
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}`));
    });
  });

  const stat = await fs.stat(outputPath);
  console.log(`[tenant-backup] done — ${stat.size} bytes`);
}

main().catch((err) => {
  console.error("[tenant-backup] failed:", err);
  process.exit(1);
});
