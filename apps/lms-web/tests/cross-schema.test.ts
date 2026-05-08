// Phase 7d integration test — proves the cross-schema helpers correctly
// surface per-tenant schema state and LMS counts, sourcing each value
// from the right place (per-tenant schema vs public, depending on the
// tenant's provisioning).
//
// Hits the LIVE local-dev DB. Skipped automatically if DATABASE_URL
// points somewhere that isn't a real Postgres.
//
// Self-contained: creates two synthetic tenants — one provisioned with
// rows in tenant_<x>.lms_*, one fallthrough with rows in public.lms_* —
// then asserts both helpers return correct values. Cleanup drops the
// schema and deletes seed rows.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as drizzleSql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  db,
  forTenant,
  isTenantSchemaName,
  members,
  tenants,
  tenantSchemaName,
  users,
} from "@tracey/db";
import { provisionTenant } from "../lib/tenancy/provision";
import {
  getTenantLmsCounts,
  getTenantSchemaInfo,
} from "../lib/tenancy/cross-schema";

const isLiveDb =
  !!process.env.DATABASE_URL && !/test:test@/.test(process.env.DATABASE_URL);

const PROVISIONED_EMAIL = "phase7d-provisioned@example.test";
const PROVISIONED_SLUG = "phase7d-provisioned-test";
const LOGICAL_EMAIL = "phase7d-logical@example.test";
const LOGICAL_SLUG = "phase7d-logical-test";

interface SeedTenant {
  tenantId: string;
  userId: string;
}

async function seedTenant(email: string, slug: string, name: string): Promise<SeedTenant> {
  const passwordHash = await bcrypt.hash("phase7d-pw", 10);
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

async function cleanupTenant(tenantId: string): Promise<void> {
  const schema = tenantSchemaName(tenantId);
  if (isTenantSchemaName(schema)) {
    await db.execute(drizzleSql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
  }
  await db.execute(
    drizzleSql`DELETE FROM app.tenant_migrations WHERE tenant_id = ${tenantId}`,
  );
  // Wipe the few public.lms_* rows we may have inserted (modules,
  // content_items, lms_users anchor). FK ordering: content_items first.
  await db.execute(
    drizzleSql.raw(
      `DELETE FROM public.content_items WHERE tracey_tenant_id = '${tenantId}'`,
    ),
  );
  await db.execute(
    drizzleSql.raw(
      `DELETE FROM public.modules WHERE tracey_tenant_id = '${tenantId}'`,
    ),
  );
  await db.execute(
    drizzleSql.raw(
      `DELETE FROM public.users WHERE tracey_tenant_id = '${tenantId}'`,
    ),
  );
}

describe.skipIf(!isLiveDb)("Phase 7d — cross-schema helpers", () => {
  let provisioned: SeedTenant;
  let logical: SeedTenant;

  beforeAll(async () => {
    provisioned = await seedTenant(
      PROVISIONED_EMAIL,
      PROVISIONED_SLUG,
      "Phase7d Provisioned",
    );
    logical = await seedTenant(LOGICAL_EMAIL, LOGICAL_SLUG, "Phase7d Logical");

    // Wipe stale state.
    await cleanupTenant(provisioned.tenantId);
    await cleanupTenant(logical.tenantId);

    // Provisioned tenant: provision schema, seed via forTenant() → lands
    // in tenant_<x>.modules + tenant_<x>.content_items.
    await provisionTenant(provisioned.tenantId);
    await forTenant(provisioned.tenantId).run(async (tx) => {
      const [m] = await tx.execute(
        drizzleSql.raw(
          `INSERT INTO modules (title, tracey_tenant_id) VALUES ` +
            `('P7d Mod 1', '${provisioned.tenantId}'), ` +
            `('P7d Mod 2', '${provisioned.tenantId}'), ` +
            `('P7d Mod 3', '${provisioned.tenantId}') RETURNING id`,
        ),
      ) as unknown as Array<{ id: number }[]>;
      void m;
      await tx.execute(
        drizzleSql.raw(
          `INSERT INTO content_items (module_id, kind, title, tracey_tenant_id) ` +
            `SELECT id, 'section', 'p7d-section', '${provisioned.tenantId}' ` +
            `FROM modules WHERE tracey_tenant_id = '${provisioned.tenantId}'`,
        ),
      );
    });
    // Anchor learner row in public.users (lms_users always lives in public).
    await db.execute(
      drizzleSql.raw(
        `INSERT INTO public.users (email, name, password_hash, role, is_active_flag, tracey_tenant_id) VALUES ` +
          `('p7d-prov-1@example.test', 'Learner 1', '$2a$10$dummy', 'employee', true, '${provisioned.tenantId}'), ` +
          `('p7d-prov-2@example.test', 'Learner 2', '$2a$10$dummy', 'employee', true, '${provisioned.tenantId}')`,
      ),
    );

    // Logical tenant: seed directly into public.* (no per-tenant schema).
    await db.execute(
      drizzleSql.raw(
        `INSERT INTO public.modules (title, tracey_tenant_id) VALUES ` +
          `('P7d Log Mod 1', '${logical.tenantId}'), ` +
          `('P7d Log Mod 2', '${logical.tenantId}')`,
      ),
    );
    await db.execute(
      drizzleSql.raw(
        `INSERT INTO public.content_items (module_id, kind, title, tracey_tenant_id) ` +
          `SELECT id, 'section', 'p7d-log-section', '${logical.tenantId}' ` +
          `FROM public.modules WHERE tracey_tenant_id = '${logical.tenantId}'`,
      ),
    );
    await db.execute(
      drizzleSql.raw(
        `INSERT INTO public.users (email, name, password_hash, role, is_active_flag, tracey_tenant_id) VALUES ` +
          `('p7d-log-1@example.test', 'Logical Learner', '$2a$10$dummy', 'employee', true, '${logical.tenantId}')`,
      ),
    );
  }, 30_000);

  afterAll(async () => {
    await cleanupTenant(provisioned.tenantId);
    await cleanupTenant(logical.tenantId);
  });

  it("getTenantSchemaInfo identifies provisioned vs logical tenants", async () => {
    const all = await getTenantSchemaInfo();
    const prov = all.find((t) => t.tenantId === provisioned.tenantId);
    const log = all.find((t) => t.tenantId === logical.tenantId);

    expect(prov, "provisioned tenant present in result").toBeDefined();
    expect(prov?.isProvisioned).toBe(true);
    expect(prov?.schemaName).toBe(tenantSchemaName(provisioned.tenantId));
    expect(prov?.isCopied).toBe(false); // Phase 7c not run on this synthetic tenant
    expect(prov?.isFrozen).toBe(false);

    expect(log, "logical tenant present in result").toBeDefined();
    expect(log?.isProvisioned).toBe(false);
    expect(log?.schemaName).toBeNull();
    expect(log?.isCopied).toBe(false);
    expect(log?.isFrozen).toBe(false);
  });

  it("getTenantLmsCounts reads from per-tenant schema for provisioned tenants", async () => {
    const all = await getTenantLmsCounts();
    const prov = all.find((t) => t.tenantId === provisioned.tenantId);
    expect(prov).toBeDefined();
    expect(prov?.modules).toBe(3);
    expect(prov?.contentItems).toBe(3);
    expect(prov?.learners).toBe(2); // Learners always come from public.users
  });

  it("getTenantLmsCounts reads from public.lms_* for logical tenants", async () => {
    const all = await getTenantLmsCounts();
    const log = all.find((t) => t.tenantId === logical.tenantId);
    expect(log).toBeDefined();
    expect(log?.modules).toBe(2);
    expect(log?.contentItems).toBe(2);
    expect(log?.learners).toBe(1);
  });

  it("provisioned tenant's modules NOT visible in public.modules count", async () => {
    // Cross-check: the provisioned tenant's modules went into
    // tenant_<x>.modules, not public. Confirms the cross-schema helper
    // is reading from the right place — a logical-mode read of the same
    // tenant would count zero.
    const rows = (await db.execute(
      drizzleSql.raw(
        `SELECT count(*)::int AS c FROM public.modules WHERE tracey_tenant_id = '${provisioned.tenantId}'`,
      ),
    )) as unknown as Array<{ c: number }>;
    expect(rows[0]?.c, "provisioned tenant's rows must NOT be in public.modules").toBe(0);
  });
});
