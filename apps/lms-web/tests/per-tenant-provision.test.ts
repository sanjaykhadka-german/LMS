// Phase 7a integration test — proves provisionTenant() builds a working
// per-tenant schema and that forTenant() routes queries through it via
// SET LOCAL search_path.
//
// Hits the LIVE local-dev DB. Skipped automatically if DATABASE_URL points
// somewhere that isn't a real Postgres ("test:test@..." default from
// setup.ts), so `pnpm vitest run` in a fresh checkout without a configured
// dev DB doesn't fail noisily.
//
// Self-contained: creates two synthetic tenants (a "provisioned" one and a
// "fallthrough" one), runs assertions, cleans up. Idempotent — re-runs
// don't accumulate.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as drizzleSql, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  BASELINE_MIGRATION_NAME,
  db,
  forTenant,
  isTenantSchemaName,
  lmsModules,
  members,
  tenants,
  tenantSchemaName,
  users,
  LMS_TABLES,
} from "@tracey/db";
import {
  provisionTenant,
  tenantSchemaExists,
} from "../lib/tenancy/provision";

const isLiveDb =
  !!process.env.DATABASE_URL && !/test:test@/.test(process.env.DATABASE_URL);

const PROVISIONED_EMAIL = "phase7a-provisioned@example.test";
const FALLTHROUGH_EMAIL = "phase7a-fallthrough@example.test";
const PROVISIONED_SLUG = "phase7a-provisioned-test";
const FALLTHROUGH_SLUG = "phase7a-fallthrough-test";
const PROBE_TITLE_PREFIX = "PROVISION-PROBE-";

interface SeedTenant {
  tenantId: string;
  userId: string;
}

async function seedTenant(
  email: string,
  slug: string,
  name: string,
): Promise<SeedTenant> {
  const passwordHash = await bcrypt.hash("phase7a-pw", 10);
  const [user] = await db
    .insert(users)
    .values({ email, name, passwordHash, emailVerified: new Date() })
    .onConflictDoUpdate({
      target: users.email,
      set: { passwordHash, emailVerified: new Date() },
    })
    .returning({ id: users.id });
  if (!user) throw new Error(`seedTenant(${slug}): users upsert returned no row`);

  const [tenant] = await db
    .insert(tenants)
    .values({ ownerUserId: user.id, slug, name, plan: "free", status: "trialing" })
    .onConflictDoUpdate({
      target: tenants.slug,
      set: { name, updatedAt: drizzleSql`now()` },
    })
    .returning({ id: tenants.id });
  if (!tenant) throw new Error(`seedTenant(${slug}): tenants upsert returned no row`);

  await db
    .insert(members)
    .values({ tenantId: tenant.id, userId: user.id, role: "owner" })
    .onConflictDoUpdate({
      target: [members.tenantId, members.userId],
      set: { role: "owner" },
    });

  return { tenantId: tenant.id, userId: user.id };
}

async function dropTenantSchema(tenantId: string): Promise<void> {
  // Safe — only ever DROPs schemas this test created, identified by the
  // strict `tenant_<uuid>` pattern.
  const schema = tenantSchemaName(tenantId);
  if (!isTenantSchemaName(schema)) return;
  await db.execute(drizzleSql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
  await db.execute(
    drizzleSql`DELETE FROM app.tenant_migrations WHERE tenant_id = ${tenantId}`,
  );
}

describe.skipIf(!isLiveDb)("Phase 7a — per-tenant schema provisioning", () => {
  let provisioned: SeedTenant;
  let fallthrough: SeedTenant;

  beforeAll(async () => {
    provisioned = await seedTenant(
      PROVISIONED_EMAIL,
      PROVISIONED_SLUG,
      "Phase7a Provisioned",
    );
    fallthrough = await seedTenant(
      FALLTHROUGH_EMAIL,
      FALLTHROUGH_SLUG,
      "Phase7a Fallthrough",
    );
    // Wipe any stale schema from a previous failed run before we start.
    await dropTenantSchema(provisioned.tenantId);
    await dropTenantSchema(fallthrough.tenantId);
  });

  afterAll(async () => {
    // Drop probe rows the test wrote, then drop the schema.
    await db.delete(lmsModules).where(eq(lmsModules.title, probeTitle("provisioned")));
    await db.delete(lmsModules).where(eq(lmsModules.title, probeTitle("fallthrough")));
    await dropTenantSchema(provisioned.tenantId);
    await dropTenantSchema(fallthrough.tenantId);
  });

  it("provisionTenant creates a schema with all 19 LMS tables", async () => {
    const result = await provisionTenant(provisioned.tenantId);
    expect(result.alreadyProvisioned).toBe(false);
    expect(result.statementCount).toBeGreaterThan(0);

    expect(await tenantSchemaExists(provisioned.tenantId)).toBe(true);

    const tableRows = (await db.execute(
      drizzleSql`SELECT tablename FROM pg_tables WHERE schemaname = ${tenantSchemaName(
        provisioned.tenantId,
      )}`,
    )) as unknown as Array<{ tablename: string }>;
    const tableNames = new Set(tableRows.map((r) => r.tablename));
    for (const expected of LMS_TABLES) {
      expect(tableNames.has(expected), `missing per-tenant table: ${expected}`).toBe(true);
    }
  });

  it("provisionTenant is idempotent on second call", async () => {
    const result = await provisionTenant(provisioned.tenantId);
    expect(result.alreadyProvisioned).toBe(true);
    expect(result.statementCount).toBe(0);
  });

  it("writes through forTenant() land in the per-tenant schema, not public", async () => {
    const title = probeTitle("provisioned");

    // Write inside forTenant().run() — the search_path SET should make
    // unqualified `modules` resolve to tenant_<uuid>.modules.
    await forTenant(provisioned.tenantId).run(async (tx) => {
      await tx.insert(lmsModules).values({
        title,
        isPublished: false,
        traceyTenantId: provisioned.tenantId,
      });
    });

    // The row should NOT be in public.modules.
    const inPublic = (await db.execute(
      drizzleSql`SELECT count(*)::int AS c FROM public.modules WHERE title = ${title}`,
    )) as unknown as Array<{ c: number }>;
    expect(inPublic[0]?.c, "row leaked into public.modules").toBe(0);

    // The row SHOULD be in tenant_<uuid>.modules.
    const schema = tenantSchemaName(provisioned.tenantId);
    const inTenant = (await db.execute(
      drizzleSql.raw(
        `SELECT count(*)::int AS c FROM "${schema}".modules WHERE title = '${title}'`,
      ),
    )) as unknown as Array<{ c: number }>;
    expect(inTenant[0]?.c, "row missing from per-tenant schema").toBe(1);
  });

  it("fallthrough tenant (no per-tenant schema) writes still land in public", async () => {
    const title = probeTitle("fallthrough");

    // Sanity: no schema for this tenant.
    expect(await tenantSchemaExists(fallthrough.tenantId)).toBe(false);

    // forTenant().run() sets search_path = "tenant_<uuid>", public — but
    // tenant_<uuid> doesn't exist, so Postgres silently falls through to
    // public.modules.
    await forTenant(fallthrough.tenantId).run(async (tx) => {
      await tx.insert(lmsModules).values({
        title,
        isPublished: false,
        traceyTenantId: fallthrough.tenantId,
      });
    });

    const inPublic = (await db.execute(
      drizzleSql`SELECT count(*)::int AS c FROM public.modules WHERE title = ${title}`,
    )) as unknown as Array<{ c: number }>;
    expect(inPublic[0]?.c, "fallthrough row missing from public.modules").toBe(1);
  });

  it("baseline ledger row written exactly once", async () => {
    const rows = (await db.execute(
      drizzleSql`SELECT count(*)::int AS c FROM app.tenant_migrations
                 WHERE tenant_id = ${provisioned.tenantId}
                 AND migration_name = ${BASELINE_MIGRATION_NAME}`,
    )) as unknown as Array<{ c: number }>;
    expect(rows[0]?.c).toBe(1);
  });
});

function probeTitle(label: string): string {
  return `${PROBE_TITLE_PREFIX}${label}`;
}
