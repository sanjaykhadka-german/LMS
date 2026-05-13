import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Separate config so Planning migrations live in their own folder and
// drizzle-kit only diff-checks the `pl_*` tables in `public`. The per-tenant
// copies in `tenant_<uuid>` schemas are provisioned by
// `packages/db/migrations/per-tenant/0012_planning_baseline.sql` (Slice 2).

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../.env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for drizzle-kit");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/planning-schema.ts",
  out: "./migrations-planning",
  // Planning template tables live in `public.pl_*` (per-tenant copies are
  // created in tenant_<uuid> schemas by the per-tenant migration runner). The
  // tablesFilter constrains drizzle-kit so it never sees `public.lms_*` or
  // `public.sc_*` (owned by other apps) and won't try to drop them.
  schemaFilter: ["public"],
  tablesFilter: ["pl_*"],
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
