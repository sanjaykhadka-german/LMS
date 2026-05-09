// RLS regression test: dataCopySql must work when run via a non-superuser
// connection where Postgres RLS is actually enforced.
//
// The default vitest DATABASE_URL connects as `root`, a Postgres superuser
// that bypasses every RLS policy. That's why the tenant-copy / tenant-backup
// / tenant-provision bugs that hit Stage 3 prod cutover (commits 4e766f5 and
// 549a6e6) passed vitest 92/92 green — the test connection silently saw
// every row regardless of `app.tenant_id`. This file reproduces prod RLS
// conditions on local by spinning a separate connection as `tracey_test_rls`
// (created by `pnpm setup:test-rls-role` — no superuser, no BYPASSRLS).
//
// SKIPPED unless RLS_TEST_DATABASE_URL is set in the shell. CI integration
// would point that env var at the dedicated role; local runs are opt-in.
//
// What this test catches: any future regression where dataCopySql or another
// per-tenant CLI loses the `set_config('app.tenant_id', tid, true)` call
// (or the equivalent forTenant wrapper). Under non-superuser RLS, source
// SELECT returns zero rows, INSERTs copy nothing, and the assertion below
// fails loudly with `expected 1, got 0` — instead of silently passing on
// local and only surfacing during prod surgery.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  dataCopySql,
  db,
  findExistingTenantRowsInPublic,
  isTenantSchemaName,
  members,
  tenantSchemaName,
  tenants,
  users,
  verifyTenantCopy,
} from "@tracey/db";
import { provisionTenant } from "../lib/tenancy/provision";

const rlsUrl = process.env.RLS_TEST_DATABASE_URL;

const SLUG = "phase7c-rls-regression";
const EMAIL = "phase7c-rls@example.test";

interface SeedTenant {
  tenantId: string;
  userId: string;
}

async function seedTenantRls(): Promise<SeedTenant> {
  const passwordHash = await bcrypt.hash("phase7c-rls-pw", 10);
  const [user] = await db
    .insert(users)
    .values({ email: EMAIL, name: "RLS Test", passwordHash, emailVerified: new Date() })
    .onConflictDoUpdate({
      target: users.email,
      set: { passwordHash, emailVerified: new Date() },
    })
    .returning({ id: users.id });
  if (!user) throw new Error("seedTenantRls: users upsert returned no row");

  const [tenant] = await db
    .insert(tenants)
    .values({
      ownerUserId: user.id,
      slug: SLUG,
      name: "Phase7c RLS Regression",
      plan: "free",
      status: "trialing",
    })
    .onConflictDoUpdate({
      target: tenants.slug,
      set: { updatedAt: drizzleSql`now()` },
    })
    .returning({ id: tenants.id });
  if (!tenant) throw new Error("seedTenantRls: tenants upsert returned no row");

  await db
    .insert(members)
    .values({ tenantId: tenant.id, userId: user.id, role: "owner" })
    .onConflictDoUpdate({
      target: [members.tenantId, members.userId],
      set: { role: "owner" },
    });

  return { tenantId: tenant.id, userId: user.id };
}

async function cleanupTenantRls(tenantId: string): Promise<void> {
  const schema = tenantSchemaName(tenantId);
  if (isTenantSchemaName(schema)) {
    await db.execute(drizzleSql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
  }
  await db.execute(
    drizzleSql`DELETE FROM app.tenant_migrations WHERE tenant_id = ${tenantId}`,
  );
  // FK-respecting order, mirroring tenant-copy.test.ts.
  const tables = [
    "content_item_media", "content_items", "module_media", "choices", "questions",
    "department_module_policies", "user_machines", "machine_modules", "attempts",
    "assignments", "module_versions", "modules", "machines", "positions",
    "audit_logs", "whs_records", "uploaded_files", "departments", "employers",
    "users",
  ] as const;
  for (const t of tables) {
    await db.execute(
      drizzleSql.raw(
        `DELETE FROM public."${t}" WHERE tracey_tenant_id = '${tenantId}'`,
      ),
    );
  }
}

describe.skipIf(!rlsUrl)("Phase 7c — dataCopySql under non-superuser RLS", () => {
  let seeded: SeedTenant;

  beforeAll(async () => {
    seeded = await seedTenantRls();
    await cleanupTenantRls(seeded.tenantId);

    // Seed a single module — enough to prove dataCopySql is non-trivially
    // copying rows. Under a buggy (RLS-blind) dataCopySql, the SELECT
    // FROM public.modules below would still see this row because we're
    // inserting via the superuser db. The downstream assertion is what
    // catches the bug.
    await db.execute(
      drizzleSql.raw(
        `INSERT INTO public.modules (title, description, is_published, tracey_tenant_id) VALUES ('rls-test', 'rls', true, '${seeded.tenantId}')`,
      ),
    );
  }, 30_000);

  afterAll(async () => {
    await cleanupTenantRls(seeded.tenantId);
  });

  it("copies the tenant's module via a non-superuser RLS-enforced connection", async () => {
    // Provision the per-tenant schema as superuser (DDL).
    await provisionTenant(seeded.tenantId);
    const schema = tenantSchemaName(seeded.tenantId);

    // Grant the test role access to the freshly-created tenant schema.
    // (Default privileges set by setup-test-rls-role.sql cover future
    // root-created tables, but explicit grants keep this test independent
    // of whether the operator ran the setup before or after this schema
    // existed.)
    await db.execute(drizzleSql.raw(`GRANT USAGE ON SCHEMA "${schema}" TO tracey_test_rls`));
    await db.execute(drizzleSql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO tracey_test_rls`));
    // UPDATE on sequences is required because dataCopySql calls setval() on each
    // ID-bearing per-tenant sequence — setval needs UPDATE, not just USAGE.
    await db.execute(drizzleSql.raw(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "${schema}" TO tracey_test_rls`));

    // Run dataCopySql via the non-superuser connection. THIS is the
    // RLS-enforced execution path. If dataCopySql ever loses its
    // set_config('app.tenant_id') call again, the SELECT side of every
    // INSERT…SELECT returns zero rows under the policy, and the assertion
    // below fails with "expected 1, received 0" — failing the local test
    // suite instead of letting the bug ride into prod.
    const rlsSql = postgres(rlsUrl!, { max: 1, prepare: false });
    try {
      const stmts = dataCopySql(seeded.tenantId);
      await rlsSql.begin(async (tx) => {
        for (const stmt of stmts) {
          await tx.unsafe(stmt);
        }
      });
    } finally {
      await rlsSql.end();
    }

    // Verify via superuser db that the module landed in the per-tenant schema.
    const rows = (await db.execute(
      drizzleSql.raw(`SELECT count(*)::int AS c FROM "${schema}".modules`),
    )) as unknown as Array<{ c: number }>;
    expect(rows[0]?.c, "non-superuser dataCopySql must copy the seeded module").toBe(1);
  });

  it("verifyTenantCopy detects a count mismatch via a non-superuser connection", async () => {
    // The previous test left the per-tenant schema with the copied module
    // (1/1 across modules + content_items). Simulate post-copy corruption
    // by deleting the module from tenant_<id>.modules — verifyTenantCopy
    // should then report ok=false with a mismatch error for `modules`.
    //
    // Without the set_config('app.tenant_id') call inside verifyTenantCopy,
    // RLS would filter both source AND copy reads to zero, the comparison
    // would be 0=0, ok would be true, and this test would fail with
    // "expected false, received true" — exactly the false-positive that
    // bit prod cutover on 2026-05-08.
    const schema = tenantSchemaName(seeded.tenantId);
    await db.execute(
      drizzleSql.raw(
        `DELETE FROM "${schema}".modules WHERE tracey_tenant_id = '${seeded.tenantId}'`,
      ),
    );

    // Run verifyTenantCopy via a fresh non-superuser drizzle instance.
    const rlsSql = postgres(rlsUrl!, { max: 1, prepare: false });
    const rlsDb = drizzle(rlsSql);
    let result;
    try {
      result = await verifyTenantCopy(rlsDb, seeded.tenantId, schema);
    } finally {
      await rlsSql.end();
    }

    expect(result.ok, "verifyTenantCopy must reject the mismatch — false positive would mean RLS is filtering source/copy reads to zero").toBe(false);
    const moduleRow = result.perTable.find((r) => r.table === "modules");
    expect(moduleRow?.source).toBe(1);
    expect(moduleRow?.copy).toBe(0);
    expect(result.errors.some((e) => e.includes("modules: source=1 copy=0"))).toBe(true);

    // Restore the deleted module so afterAll's cleanupTenantRls runs cleanly
    // (DROP SCHEMA CASCADE would handle it anyway, but keeping state tidy
    // costs nothing).
    await db.execute(drizzleSql.raw(`DROP SCHEMA "${schema}" CASCADE`));
    await db.execute(drizzleSql`DELETE FROM app.tenant_migrations WHERE tenant_id = ${seeded.tenantId}`);
  });

  it("findExistingTenantRowsInPublic detects the seeded module via non-superuser", async () => {
    // The provisioning safety-check is meant to refuse running when
    // public.lms_* still has rows for the tenant — provisioning would
    // shadow that data. With a buggy (RLS-blind) implementation, the
    // count returns 0 under prod's non-superuser RLS and the safety
    // check silently passes, removing the operator's warning.
    //
    // The seeded module from beforeAll is still in public.modules
    // (afterAll runs cleanupTenantRls after all tests). Run the
    // safety check via the non-superuser connection and assert the
    // module is detected.
    const rlsSql = postgres(rlsUrl!, { max: 1, prepare: false });
    const rlsDb = drizzle(rlsSql);
    let offender;
    try {
      offender = await findExistingTenantRowsInPublic(rlsDb, seeded.tenantId);
    } finally {
      await rlsSql.end();
    }

    expect(offender, "findExistingTenantRowsInPublic must detect the seeded module — null would mean RLS is hiding the row from the safety check").not.toBeNull();
    expect(offender?.table).toBe("modules");
    expect(offender?.count).toBe(1);
  });
});
