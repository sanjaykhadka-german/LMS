import { drizzle } from "drizzle-orm/postgres-js";
import { sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForPostgres = globalThis as unknown as {
  __traceyPostgres?: postgres.Sql;
};

const sql =
  globalForPostgres.__traceyPostgres ??
  postgres(databaseUrl, {
    max: 10,
    prepare: false,
    idle_timeout: 30,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPostgres.__traceyPostgres = sql;
}

export const db = drizzle(sql, { schema, logger: process.env.NODE_ENV === "development" });
export { sql as pg };
export * from "./schema";

// ─── Tenant scoping (defense-in-depth for shared-schema multitenancy) ────
//
// `forTenant(tid)` returns a transaction runner that injects two things at
// the start of every transaction it opens:
//
//   1. SELECT set_config('app.tenant_id', <tid>, true)
//      Postgres RLS policies (0004_enable_rls.sql + per-tenant `tenant_isolation`
//      policies created by provisionTenant) read this GUC to enforce per-tenant
//      row visibility. A missing WHERE tracey_tenant_id filter in application
//      code can no longer leak across tenants.
//
//   2. SET LOCAL search_path = "tenant_<uuid>", public  (Phase 7a)
//      If a per-tenant schema exists, Drizzle's unqualified table names
//      (`pgTable("modules", ...)` resolves to bare "modules") are looked up
//      against this list in order. Tenants with a per-tenant schema get
//      physical isolation; tenants without one fall through to `public.*`
//      with RLS as the safety net (current behaviour for the existing GB
//      tenant pre-Phase-7c).
//
//      The `app` schema is intentionally NOT in this search_path. Drizzle
//      already schema-qualifies every reference into `app` (every query
//      built from `appSchema.table(...)` emits "app"."tablename" in SQL),
//      so omitting it from search_path costs nothing — and prevents
//      `app.users` (Tracey UUID-keyed auth table) from shadowing the
//      legacy `public.users` (lms_users) for unqualified Drizzle queries
//      against `pgTable("users", ...)`.
//
// Both settings are transaction-local — `true` to set_config and `SET LOCAL`
// — so they're safe under shared connection pooling: cleared on COMMIT/ROLLBACK.
//
// Usage:
//   const ctx = await requireAdmin();          // attaches ctx.db
//   const rows = await ctx.db.run((tx) =>
//     tx.select().from(lmsDepartments).where(...),
//   );

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface TenantDb {
  readonly tenantId: string;
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export function forTenant(tenantId: string): TenantDb {
  // The tenant schema name is derived deterministically from the tenant
  // UUID — quoted because UUIDs contain dashes. Kept as a literal here
  // (rather than imported from per-tenant-schema.ts) because client.ts
  // is the bottom of the dependency graph and importing upward would
  // create a cycle.
  const schemaIdent = `"tenant_${tenantId}"`;
  return {
    tenantId,
    async run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        await tx.execute(
          drizzleSql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
        );
        await tx.execute(
          drizzleSql.raw(`SET LOCAL search_path = ${schemaIdent}, public`),
        );
        return fn(tx);
      });
    },
  };
}
