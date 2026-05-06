import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

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
