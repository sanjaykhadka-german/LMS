import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Mirror of migrate.ts but for the ShiftCraft Postgres schema. Kept separate
// so ShiftCraft can be migrated independently of the app-schema migration
// history.

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../../.env") });

// Applies the `public.sc_*` template-table migrations. These are the source
// shape used by the per-tenant baseline (migrations/per-tenant/0009_shiftcraft_baseline.sql)
// when it creates per-tenant copies via `CREATE TABLE … LIKE INCLUDING ALL`.
//
// Order:
//   1. pnpm db:migrate-shiftcraft    (this script — creates public.sc_*)
//   2. pnpm db:migrate-tenants       (per-tenant runner — copies into tenants)

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle(sql);
  await migrate(db, {
    migrationsFolder: "./migrations-shiftcraft",
    migrationsSchema: "drizzle_shiftcraft",
  });

  await sql.end();
  console.log("[db] shiftcraft template migrations applied to public.sc_*");
}

main().catch((err) => {
  console.error("[db] shiftcraft migration failed:", err);
  process.exit(1);
});
