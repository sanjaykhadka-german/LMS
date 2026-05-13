import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Separate config so ShiftCraft migrations live in their own folder and
// drizzle-kit only diff-checks the `shiftcraft` Postgres schema. This keeps
// the existing app-schema migration history untouched.

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../.env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for drizzle-kit");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/shiftcraft-schema.ts",
  out: "./migrations-shiftcraft",
  // ShiftCraft template tables live in `public.sc_*` (per-tenant copies are
  // created in tenant_<uuid> schemas by the per-tenant migration runner). The
  // tablesFilter constrains drizzle-kit so it never sees `public.lms_*`
  // (Flask-owned) and won't try to drop them.
  schemaFilter: ["public"],
  tablesFilter: ["sc_*"],
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
