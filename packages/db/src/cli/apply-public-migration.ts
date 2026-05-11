// Apply a single public-schema SQL migration (the manual/* files under
// packages/db/migrations/manual/) without needing psql on PATH. Uses the
// same postgres-js client as the app.
//
// Usage:
//   pnpm --filter @tracey/db tsx src/cli/apply-public-migration.ts <path>

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
loadEnv({ path: path.resolve(repoRoot, ".env") });

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: tsx src/cli/apply-public-migration.ts <path-to-sql>");
    process.exit(2);
  }
  const sqlPath = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  // Strip psql-only directives that aren't valid SQL (\set, \restrict, etc).
  const raw = await fs.readFile(sqlPath, "utf8");
  const cleaned = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("\\"))
    .join("\n");

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  console.log(`[apply-public-migration] ${path.basename(sqlPath)}`);
  try {
    await sql.unsafe(cleaned);
    console.log("[apply-public-migration] done");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[apply-public-migration] failed:", err);
  process.exit(1);
});
