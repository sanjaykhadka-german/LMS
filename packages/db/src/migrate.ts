import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Single source of truth: the workspace-root .env. Loaded explicitly because
// pnpm runs this script with cwd = packages/db/, not the repo root, so
// `dotenv/config`'s default cwd lookup misses it.
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../../.env") });

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  await sql`CREATE SCHEMA IF NOT EXISTS app`;

  const db = drizzle(sql);
  await migrate(db, {
    migrationsFolder: "./migrations",
    migrationsSchema: "drizzle",
  });

  await sql.end();
  console.log("[db] migrations applied");
}

main().catch((err) => {
  console.error("[db] migration failed:", err);
  process.exit(1);
});
