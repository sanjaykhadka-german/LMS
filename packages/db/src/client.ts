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
// `forTenant(tid)` returns a transaction runner that injects
//   SELECT set_config('app.tenant_id', <tid>, true)
// at the start of every transaction it opens. Postgres RLS policies
// (migration 0004_enable_rls.sql) read this GUC to enforce per-tenant row
// visibility on every legacy LMS table, so a missing
// `WHERE tracey_tenant_id = $1` in application code can no longer leak
// across tenants.
//
// Usage:
//   const ctx = await requireAdmin();          // attaches ctx.db
//   const rows = await ctx.db.run((tx) =>
//     tx.select().from(lmsDepartments).where(...),
//   );
//
// The third arg `true` to set_config is what makes this safe with a shared
// connection pool: the GUC is transaction-local and cleared on COMMIT/
// ROLLBACK, so it cannot leak to whatever request next checks out the same
// connection.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface TenantDb {
  readonly tenantId: string;
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export function forTenant(tenantId: string): TenantDb {
  return {
    tenantId,
    async run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        await tx.execute(
          drizzleSql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
        );
        return fn(tx);
      });
    },
  };
}
