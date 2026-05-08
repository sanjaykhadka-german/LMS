// Idempotent seed for two synthetic test tenants ("Tenant A" and
// "Tenant B"), used by the cross-tenant isolation spec. Both tenants are
// owned by separate users and have separate `lms_users` rows; the spec
// signs in as each one in turn and proves data does not leak across.
//
// Why synthetic both tenants instead of reusing the E2E_EMAIL admin?
//  - Removes dependency on .env.test.local for this spec — the isolation
//    test is the most important regression net for Phase 6/7 and should
//    just work after `pnpm install`.
//  - Keeps the spec hermetic: it doesn't touch the GB tenant or any
//    real-looking admin data.
//
// Re-running the spec must not duplicate rows or invalidate prior
// credentials, so all writes are upserts keyed on natural unique columns
// (users.email, tenants.slug, members.tenantId+userId).
//
// Local-only: this code touches the dev DB directly and is never imported
// from a production code path.

import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db, lmsModules, lmsUsers, members, tenants, users } from "@tracey/db";

export interface TestTenant {
  tenantId: string;
  userId: string;
  email: string;
  password: string;
}

interface SeedSpec {
  email: string;
  password: string;
  slug: string;
  tenantName: string;
  userName: string;
}

const TENANT_A: SeedSpec = {
  email: process.env.E2E_TENANT_A_EMAIL ?? "tenant-a-admin@example.test",
  password: process.env.E2E_TENANT_A_PASSWORD ?? "tenant-a-pass-1",
  slug: process.env.E2E_TENANT_A_SLUG ?? "tenant-a-isolation-test",
  tenantName: process.env.E2E_TENANT_A_NAME ?? "Tenant A (isolation test)",
  userName: "Tenant A Admin",
};

const TENANT_B: SeedSpec = {
  email: process.env.E2E_TENANT_B_EMAIL ?? "tenant-b-admin@example.test",
  password: process.env.E2E_TENANT_B_PASSWORD ?? "tenant-b-pass-1",
  slug: process.env.E2E_TENANT_B_SLUG ?? "tenant-b-isolation-test",
  tenantName: process.env.E2E_TENANT_B_NAME ?? "Tenant B (isolation test)",
  userName: "Tenant B Admin",
};

async function ensureTenant(spec: SeedSpec): Promise<TestTenant> {
  const passwordHash = await bcrypt.hash(spec.password, 10);

  // 1. Upsert app.users by email. Email-verified so the auth fast-path accepts it.
  const [user] = await db
    .insert(users)
    .values({
      email: spec.email,
      name: spec.userName,
      passwordHash,
      emailVerified: new Date(),
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { passwordHash, emailVerified: new Date(), name: spec.userName },
    })
    .returning({ id: users.id });
  if (!user) throw new Error(`ensureTenant(${spec.slug}): failed to upsert app.users row`);

  // 2. Upsert app.tenants by slug. Owner is the user we just made/found.
  const [tenant] = await db
    .insert(tenants)
    .values({
      ownerUserId: user.id,
      slug: spec.slug,
      name: spec.tenantName,
      plan: "free",
      status: "trialing",
    })
    .onConflictDoUpdate({
      target: tenants.slug,
      set: { name: spec.tenantName, updatedAt: sql`now()` },
    })
    .returning({ id: tenants.id });
  if (!tenant) throw new Error(`ensureTenant(${spec.slug}): failed to upsert app.tenants row`);

  // 3. Upsert app.members by (tenantId, userId). Role: owner so the test
  //    user can hit /app/admin/* routes the same way a real owner does.
  await db
    .insert(members)
    .values({ tenantId: tenant.id, userId: user.id, role: "owner" })
    .onConflictDoUpdate({
      target: [members.tenantId, members.userId],
      set: { role: "owner" },
    });

  // 4. Upsert the matching legacy lms_users row. requireAdmin() calls
  //    getOrProvisionLmsUser() which would auto-provision this on first
  //    sign-in, but pre-creating it keeps the first test run deterministic.
  const lmsHash = await bcrypt.hash(spec.password, 10);
  await db
    .insert(lmsUsers)
    .values({
      email: spec.email,
      name: spec.userName,
      firstName: spec.userName.split(" ")[0] ?? spec.userName,
      lastName: spec.userName.split(" ").slice(1).join(" "),
      passwordHash: lmsHash,
      role: "owner",
      isActiveFlag: true,
      traceyUserId: user.id,
      traceyTenantId: tenant.id,
    })
    .onConflictDoUpdate({
      target: lmsUsers.email,
      set: {
        traceyUserId: user.id,
        traceyTenantId: tenant.id,
        isActiveFlag: true,
        role: "owner",
      },
    });

  return {
    tenantId: tenant.id,
    userId: user.id,
    email: spec.email,
    password: spec.password,
  };
}

export async function ensureTenantA(): Promise<TestTenant> {
  return ensureTenant(TENANT_A);
}

export async function ensureTenantB(): Promise<TestTenant> {
  return ensureTenant(TENANT_B);
}

export async function deleteModulesByTitle(title: string): Promise<number> {
  // Cleanup helper: removes any probe rows that the spec leaked. Safe to
  // call repeatedly. Filters by title so we never touch unrelated data.
  const rows = await db
    .delete(lmsModules)
    .where(eq(lmsModules.title, title))
    .returning({ id: lmsModules.id });
  return rows.length;
}

export async function createProbeModule(opts: {
  tenantId: string;
  title: string;
}): Promise<number> {
  // Insert a module owned by `tenantId`. Bypasses the admin UI form on
  // purpose — the isolation test cares about cross-tenant reads, not the
  // create flow. Returns the new module's numeric ID.
  const [row] = await db
    .insert(lmsModules)
    .values({
      title: opts.title,
      isPublished: false,
      traceyTenantId: opts.tenantId,
    })
    .returning({ id: lmsModules.id });
  if (!row) throw new Error("createProbeModule: insert returned no row");
  return row.id;
}
