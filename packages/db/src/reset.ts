import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

// Workspace-root .env (this script runs from packages/db/, not repo root).
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../../.env") });

/**
 * Drops both the `app` schema (Tracey tables) and the `drizzle` schema
 * (drizzle-kit's migration journal) from the configured DATABASE_URL.
 *
 * After this runs, `pnpm db:migrate` will re-apply 0000 from scratch.
 *
 * USE WITH CARE — this destroys all Tracey-side data. Idempotent (safe to
 * re-run if it half-fails).
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  // Refuse to run against a production-looking URL unless TRACEY_RESET_FORCE=1.
  // Cheap heuristic: if the host isn't localhost/127.0.0.1 and FORCE isn't
  // set, bail. Stops accidental nukes of Render Postgres.
  const url = new URL(databaseUrl);
  const isLocal =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (!isLocal && process.env.TRACEY_RESET_FORCE !== "1") {
    throw new Error(
      `Refusing to reset against non-local DATABASE_URL host '${url.hostname}'. ` +
        `Set TRACEY_RESET_FORCE=1 to override (only do this against a known-disposable DB).`,
    );
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  console.log(`[db:reset] dropping schemas on ${url.hostname}/${url.pathname.slice(1)}`);
  await sql`DROP SCHEMA IF EXISTS app CASCADE`;
  await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  await sql.end();
  console.log("[db:reset] done. Run `pnpm db:migrate` next.");
}

main().catch((err) => {
  console.error("[db:reset] failed:", err);
  process.exit(1);
});
