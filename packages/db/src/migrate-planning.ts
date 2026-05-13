import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Mirror of migrate-shiftcraft.ts but for the planning Postgres schema. Kept
// separate so planning can be migrated independently of the app-schema and
// shiftcraft migration histories.

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../../.env") });

// Applies the `public.pl_*` template-table migrations. These are the source
// shape used by the per-tenant baseline (migrations/per-tenant/0012_planning_baseline.sql)
// when it creates per-tenant copies via `CREATE TABLE … LIKE INCLUDING ALL`,
// and the RPC layer (migrations/per-tenant/0013_planning_rpcs.sql) that wires
// triggers + PL/pgSQL into each tenant schema.
//
// Order:
//   1. pnpm db:migrate-planning      (this script — creates public.pl_*)
//   2. pnpm db:migrate-tenants       (per-tenant runner — copies into tenants,
//                                     then applies 0012 + 0013 to each)

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle(sql);
  await migrate(db, {
    migrationsFolder: "./migrations-planning",
    migrationsSchema: "drizzle_planning",
  });

  await sql.end();
  console.log("[db] planning template migrations applied to public.pl_*");
}

main().catch((err) => {
  console.error("[db] planning migration failed:", err);
  process.exit(1);
});
