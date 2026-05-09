// Phase 7c — verification helper for the per-tenant data copy.
//
// Extracted from tenant-copy.ts so the same logic is reachable from both
// the CLI and the regression-test suite. Behaviour is unchanged from the
// inline version in tenant-copy.ts on commit 4e766f5: wraps every read in
// a transaction with tx-local `app.tenant_id` set, so RLS policies on
// public.lms_* and tenant_<x>.lms_* admit this tenant's rows. Without
// the GUC, every count returns zero under prod RLS and verify falsely
// passes (source=0 vs copy=0) — the exact bug pattern caught during
// the 2026-05-08 prod cutover.
//
// Three checks:
//   1. Per-table count match between public.<t> (source) and
//      tenant_<x>.<t> (copy) for the given tenant.
//   2. Sequence advance — every ID-bearing per-tenant sequence's
//      last_value must be >= max(id) so the next nextval doesn't collide.
//   3. FK integrity smoke — content_items.module_id must resolve to a
//      row in tenant_<x>.modules (proxy for "FKs were copied with the
//      data and the per-tenant references are intact").

import { sql as drizzleSql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { LMS_TABLES, LMS_TABLES_WITH_ID } from "./per-tenant-schema";

/**
 * Safety-check helper for tenant-provision. Returns the first
 * `public.lms_*` table containing rows for the given tenant, or null
 * if all tables are empty. The CLI uses this to refuse provisioning
 * when data exists in `public.*` (which would be shadowed by the new
 * empty per-tenant schema until tenant-copy runs).
 *
 * Wrapped in a transaction with tx-local `app.tenant_id` so the RLS
 * policies on `public.lms_*` admit this tenant's rows under prod's
 * non-superuser role. Without the GUC, every count returns 0 and the
 * guard silently passes — the same RLS-blind bug pattern the
 * verifyTenantCopy fix above addresses.
 */
export interface ProvisionOffender {
  table: string;
  count: number;
}

export async function findExistingTenantRowsInPublic(
  db: ReturnType<typeof drizzle>,
  tenantId: string,
): Promise<ProvisionOffender | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      drizzleSql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
    );
    for (const table of LMS_TABLES) {
      const rows = (await tx.execute(
        drizzleSql.raw(
          `SELECT count(*)::int AS c FROM public.${q(table)} WHERE tracey_tenant_id = '${tenantId}'`,
        ),
      )) as unknown as Array<{ c: number }>;
      const count = rows[0]?.c ?? 0;
      if (count > 0) return { table, count };
    }
    return null;
  });
}

export interface VerificationResult {
  ok: boolean;
  errors: string[];
  perTable: Array<{ table: string; source: number; copy: number }>;
}

function q(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

export async function verifyTenantCopy(
  db: ReturnType<typeof drizzle>,
  tenantId: string,
  schema: string,
): Promise<VerificationResult> {
  return db.transaction(async (tx) => {
    const errors: string[] = [];
    const perTable: VerificationResult["perTable"] = [];

    await tx.execute(
      drizzleSql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
    );

    // 1. Per-table count match.
    for (const table of LMS_TABLES) {
      const sourceRows = (await tx.execute(
        drizzleSql.raw(
          `SELECT count(*)::int AS c FROM public.${q(table)} WHERE tracey_tenant_id = '${tenantId}'`,
        ),
      )) as unknown as Array<{ c: number }>;
      const copyRows = (await tx.execute(
        drizzleSql.raw(`SELECT count(*)::int AS c FROM ${q(schema)}.${q(table)}`),
      )) as unknown as Array<{ c: number }>;
      const source = sourceRows[0]?.c ?? 0;
      const copy = copyRows[0]?.c ?? 0;
      perTable.push({ table, source, copy });
      if (source !== copy) {
        errors.push(`${table}: source=${source} copy=${copy} (mismatch)`);
      }
    }

    // 2. Sequence advance check — for every ID-bearing table, the sequence's
    //    last_value should equal max(id) when rows exist, or be at default (1)
    //    when empty.
    for (const table of LMS_TABLES_WITH_ID) {
      const rows = (await tx.execute(
        drizzleSql.raw(
          `SELECT ` +
            `(SELECT MAX(id) FROM ${q(schema)}.${q(table)}) AS max_id, ` +
            `(SELECT last_value FROM ${q(schema)}.${q(`${table}_id_seq`)}) AS seq_last`,
        ),
      )) as unknown as Array<{ max_id: number | null; seq_last: number }>;
      const r = rows[0];
      if (!r) {
        errors.push(`${table}: sequence check returned no row`);
        continue;
      }
      if (r.max_id !== null && Number(r.seq_last) < Number(r.max_id)) {
        errors.push(
          `${table}: sequence last_value (${r.seq_last}) < max(id) (${r.max_id}); next nextval would collide`,
        );
      }
    }

    // 3. FK integrity smoke — content_items.module_id must resolve inside
    //    the per-tenant schema. Picked because it's a chain (modules →
    //    content_items → content_item_media) and validates that within-LMS
    //    FKs were copied/recreated correctly.
    const fkRows = (await tx.execute(
      drizzleSql.raw(
        `SELECT count(*)::int AS c FROM ${q(schema)}.content_items ci ` +
          `LEFT JOIN ${q(schema)}.modules m ON m.id = ci.module_id ` +
          `WHERE m.id IS NULL AND ci.module_id IS NOT NULL`,
      ),
    )) as unknown as Array<{ c: number }>;
    const orphaned = fkRows[0]?.c ?? 0;
    if (orphaned > 0) {
      errors.push(`content_items: ${orphaned} rows with module_id pointing nowhere in the per-tenant schema`);
    }

    return { ok: errors.length === 0, errors, perTable };
  });
}
