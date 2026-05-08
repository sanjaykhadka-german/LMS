// Phase 7d — cross-schema helpers for the platform admin views.
//
// `/platform/tenants` and `/platform/tenants/[id]` need to surface, per
// tenant: whether it has a per-tenant schema (Phase 7a/7c), and how
// much LMS data it contains. After Phase 7c rolls out, that data lives
// in a different place depending on the tenant's provisioning status:
//
//   - Provisioned (post-7c GB, plus any 7a/7b new tenants): rows live in
//     tenant_<uuid>.<table>. Read directly from the per-tenant schema.
//   - Logical (pre-7c GB, fallthrough): rows live in public.<table>
//     filtered by tracey_tenant_id. Read with the WHERE filter.
//
// Both helpers are SELECT-only. They run as platform-admin queries
// outside `forTenant()` (which scopes to a single tenant via search_path
// — useless when you need to enumerate every tenant).
//
// allow-no-fortenant: platform admin enumeration is intrinsically
// cross-tenant. lib/tenancy/ is excluded from check-tenant-scope's scan
// dirs, so this comment is documentation rather than lint silencing.

import { sql as drizzleSql } from "drizzle-orm";
import {
  BASELINE_MIGRATION_NAME,
  DATA_COPY_MIGRATION_NAME,
  FREEZE_MIGRATION_NAME,
  db,
  tenantSchemaName,
} from "@tracey/db";

export interface TenantSchemaInfo {
  tenantId: string;
  slug: string;
  name: string;
  isProvisioned: boolean;
  /** Set when isProvisioned is true. */
  schemaName: string | null;
  isCopied: boolean;
  isFrozen: boolean;
}

export interface TenantLmsCounts {
  tenantId: string;
  modules: number;
  contentItems: number;
  /** Always read from public.users (lms_users stays in public per Phase 7 design). */
  learners: number;
}

/**
 * Returns one row per tenant with its provisioning status. Joined from
 * `app.tenants` + `app.tenant_migrations` ledger — single round-trip.
 *
 * Provisioning status is derived from ledger entries:
 *   - isProvisioned: 0006_baseline applied (schema exists with DDL)
 *   - isCopied:      0007_data_copy applied (data moved from public)
 *   - isFrozen:      0008_freeze applied (public.lms_* writes disabled)
 *
 * isProvisioned implies the schema exists; we don't probe pg_namespace
 * because the ledger is the source of truth (a manually-DROPped schema
 * with a stale ledger row would surface as "isProvisioned but missing"
 * — that's an operator error worth showing as-is).
 */
export async function getTenantSchemaInfo(): Promise<TenantSchemaInfo[]> {
  const rows = (await db.execute(
    drizzleSql`
      SELECT
        t.id::text          AS tenant_id,
        t.slug              AS slug,
        t.name              AS tname,
        EXISTS(SELECT 1 FROM app.tenant_migrations m WHERE m.tenant_id = t.id AND m.migration_name = ${BASELINE_MIGRATION_NAME}) AS is_provisioned,
        EXISTS(SELECT 1 FROM app.tenant_migrations m WHERE m.tenant_id = t.id AND m.migration_name = ${DATA_COPY_MIGRATION_NAME}) AS is_copied,
        EXISTS(SELECT 1 FROM app.tenant_migrations m WHERE m.tenant_id = t.id AND m.migration_name = ${FREEZE_MIGRATION_NAME}) AS is_frozen
      FROM app.tenants t
      ORDER BY t.created_at DESC
    `,
  )) as unknown as Array<{
    tenant_id: string;
    slug: string;
    tname: string;
    is_provisioned: boolean;
    is_copied: boolean;
    is_frozen: boolean;
  }>;

  return rows.map((r) => ({
    tenantId: r.tenant_id,
    slug: r.slug,
    name: r.tname,
    isProvisioned: r.is_provisioned,
    schemaName: r.is_provisioned ? tenantSchemaName(r.tenant_id) : null,
    isCopied: r.is_copied,
    isFrozen: r.is_frozen,
  }));
}

/**
 * Returns LMS row counts per tenant. For each tenant, three queries:
 * modules, content_items, learners (lms_users). Source switches on
 * provisioning state: provisioned → tenant schema; logical → public.
 *
 * `learners` always reads from public.users — `lms_users` stays in
 * public permanently per the Phase 7 design (auth bridge dependency,
 * see 0004_enable_rls.sql:105-115).
 *
 * For ~50 tenants this is ≤150 round-trips. Acceptable for an admin
 * surface that renders on demand. If it ever becomes hot, materialise
 * an `app.platform_index` view refreshed on tenant write events.
 *
 * Errors per metric default to 0 with console.error logging — the
 * platform admin page should remain renderable even if a single tenant
 * has a partially-provisioned schema or other anomaly.
 */
export async function getTenantLmsCounts(): Promise<TenantLmsCounts[]> {
  const tenants = await getTenantSchemaInfo();
  const out: TenantLmsCounts[] = [];

  for (const t of tenants) {
    const modules = await safeCount(
      t.isProvisioned
        ? `SELECT count(*)::int AS c FROM "${t.schemaName}".modules`
        : `SELECT count(*)::int AS c FROM public.modules WHERE tracey_tenant_id = '${t.tenantId}'`,
      `${t.slug} modules`,
    );
    const contentItems = await safeCount(
      t.isProvisioned
        ? `SELECT count(*)::int AS c FROM "${t.schemaName}".content_items`
        : `SELECT count(*)::int AS c FROM public.content_items WHERE tracey_tenant_id = '${t.tenantId}'`,
      `${t.slug} content_items`,
    );
    // Learners always live in public.users (lms_users).
    const learners = await safeCount(
      `SELECT count(*)::int AS c FROM public.users WHERE tracey_tenant_id = '${t.tenantId}'`,
      `${t.slug} learners`,
    );

    out.push({
      tenantId: t.tenantId,
      modules,
      contentItems,
      learners,
    });
  }

  return out;
}

async function safeCount(sql: string, label: string): Promise<number> {
  try {
    const rows = (await db.execute(drizzleSql.raw(sql))) as unknown as Array<{ c: number }>;
    return rows[0]?.c ?? 0;
  } catch (err) {
    console.error(`[cross-schema] count failed for ${label}:`, err);
    return 0;
  }
}
