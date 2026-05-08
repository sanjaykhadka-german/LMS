// Phase 7a — provisionTenant() helper.
//
// Creates a fresh `tenant_<uuid>` schema with all 19 LMS tables, sequences,
// FKs, RLS policies. Idempotent: re-running on an already-provisioned
// tenant is a no-op (consults `app.tenant_migrations` for the baseline
// marker). Single transaction — partial failure rolls back the whole
// thing, leaving the DB exactly as it was.
//
// allow-no-fortenant: this code creates the per-tenant schema BEFORE any
// per-tenant query path exists, and runs `CREATE SCHEMA` / `CREATE TABLE`
// DDL that can't be wrapped in `forTenant()` (which sets a search_path
// pointing at a schema that doesn't yet exist). The lint allowlist in
// scripts/check-tenant-scope.mjs recognises this comment.
//
// Note: `import "server-only"` is intentionally NOT used here even though
// this module is server-side only. It's also imported by Playwright
// fixtures (apps/lms-web/tests/e2e/_setup/tenant-b.ts) which run in raw
// Node without the Next.js stub. The realistic import surface (server
// actions + tests) is server-only by construction; the lint above plus
// directory placement (lib/tenancy/, not components/) is the guarantee.

import {
  BASELINE_MIGRATION_NAME,
  db,
  provisionSql,
  tenantSchemaName,
} from "@tracey/db";
import { sql as drizzleSql } from "drizzle-orm";

export interface ProvisionResult {
  tenantId: string;
  schema: string;
  alreadyProvisioned: boolean;
  statementCount: number;
}

/**
 * Idempotent. If `tenant_<uuid>` already exists AND the baseline ledger
 * row is present, returns immediately with `alreadyProvisioned: true`.
 * Otherwise runs the full DDL sequence in one transaction and writes the
 * ledger row.
 *
 * Throws on any DDL failure — caller (typically the onboarding flow)
 * should surface the error so the broken half-state is visible. Because
 * we run inside a transaction, the half-state never reaches the DB:
 * either the schema is fully built or it doesn't exist.
 */
export async function provisionTenant(tenantId: string): Promise<ProvisionResult> {
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    // Defensive: tenantId is interpolated into identifiers and SQL
    // literals. Reject anything that isn't a UUID before we get near a
    // CREATE SCHEMA call.
    throw new Error(`provisionTenant: invalid tenantId ${JSON.stringify(tenantId)}`);
  }

  const schema = tenantSchemaName(tenantId);

  // Cheap probe: skip the full DDL run if the baseline ledger row exists.
  // (We check the ledger rather than just pg_namespace so a partially-
  // provisioned schema from a crashed earlier run gets re-attempted.)
  const ledger = await db.execute(
    drizzleSql`SELECT 1 FROM app.tenant_migrations WHERE tenant_id = ${tenantId} AND migration_name = ${BASELINE_MIGRATION_NAME} LIMIT 1`,
  );
  if (Array.isArray(ledger) ? ledger.length > 0 : (ledger as { length?: number })?.length) {
    return { tenantId, schema, alreadyProvisioned: true, statementCount: 0 };
  }

  const stmts = provisionSql(tenantId);

  await db.transaction(async (tx) => {
    for (const stmt of stmts) {
      await tx.execute(drizzleSql.raw(stmt));
    }
    await tx.execute(
      drizzleSql`INSERT INTO app.tenant_migrations (tenant_id, migration_name) VALUES (${tenantId}, ${BASELINE_MIGRATION_NAME}) ON CONFLICT DO NOTHING`,
    );
  });

  return { tenantId, schema, alreadyProvisioned: false, statementCount: stmts.length };
}

/**
 * Probe — returns true iff the schema row exists in pg_namespace. Used by
 * the provisioning E2E spec and ops runbooks. Does not consult the ledger.
 */
export async function tenantSchemaExists(tenantId: string): Promise<boolean> {
  const schema = tenantSchemaName(tenantId);
  const probe = await db.execute(
    drizzleSql`SELECT 1 FROM pg_namespace WHERE nspname = ${schema} LIMIT 1`,
  );
  return Array.isArray(probe)
    ? probe.length > 0
    : Boolean((probe as { length?: number })?.length);
}
