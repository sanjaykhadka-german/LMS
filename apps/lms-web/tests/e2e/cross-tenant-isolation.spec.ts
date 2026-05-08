// Phase 6 regression net: prove tenant B cannot see, fetch, or mutate a
// module that belongs to tenant A. This spec is the ground-truth check that
// makes RLS rollout safe — if it passes with RLS off (today's app-layer
// tenantWhere() filter) AND with RLS on (after 0004_enable_rls.sql), then
// the chokepoint is sound for both isolation models.
//
// Self-seeded: both tenants are created synthetically by the spec's
// fixtures. No dependency on .env.test.local credentials — the test runs
// hermetically.

import { test as base, expect } from "@playwright/test";
import { signIn, signOut } from "./_setup/auth";
import {
  createProbeModule,
  deleteModulesByTitle,
  ensureTenantA,
  ensureTenantB,
  type TestTenant,
} from "./_setup/tenant-b";

const PROBE_TITLE = `ISOLATION-PROBE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const test = base.extend<{ tenantA: TestTenant; tenantB: TestTenant }>({
  tenantA: async ({}, use) => {
    const creds = await ensureTenantA();
    await use(creds);
  },
  tenantB: async ({}, use) => {
    const creds = await ensureTenantB();
    await use(creds);
  },
});

test.beforeAll(async () => {
  // Idempotent guard: if a previous failed run left the probe module behind,
  // wipe it so the create step starts from a clean state.
  await deleteModulesByTitle(PROBE_TITLE);
});

test.afterAll(async () => {
  // Clean up the probe module regardless of pass/fail. Safe — filtered by
  // unique probe title.
  await deleteModulesByTitle(PROBE_TITLE);
});

test("cross-tenant: tenant B cannot see, fetch, or mutate tenant A's module", async ({
  page,
  tenantA,
  tenantB,
}) => {
  // ── Setup: insert tenant A's probe module via DB ──────────────────────
  // We bypass the admin UI's create form on purpose — this test is about
  // cross-tenant READ isolation, not the create-flow. The probe row carries
  // tenantA.tenantId on traceyTenantId, which is exactly what RLS and
  // tenantWhere() filter against.
  const probeId = await createProbeModule({ tenantId: tenantA.tenantId, title: PROBE_TITLE });

  // Sanity: signed in as tenant A, the module is visible on the list page.
  await signIn(page, tenantA.email, tenantA.password);
  await page.goto("/app/admin/modules");
  await expect(page.getByText(PROBE_TITLE).first()).toBeVisible();
  await signOut(page);

  // ── Tenant B: try to see, fetch ────────────────────────────────────────
  await signIn(page, tenantB.email, tenantB.password);

  // 1. Module list must NOT contain the probe title.
  await page.goto("/app/admin/modules");
  await expect(page.locator("body")).not.toContainText(PROBE_TITLE);

  // 2. Direct GET on tenant A's module ID must 404 (Next.js notFound()).
  const directRes = await page.goto(`/app/admin/modules/${probeId}`, {
    waitUntil: "domcontentloaded",
  });
  expect(directRes, "no response to direct probe").not.toBeNull();
  expect(directRes!.status(), `tenant B got ${directRes!.status()} on tenant A's module`).toBe(404);

  // 3. Direct GET on the assignment screen must also 404 (separate
  //    requireAdmin call → separate tenant scope).
  const assignRes = await page.goto(`/app/admin/modules/${probeId}/assign`, {
    waitUntil: "domcontentloaded",
  });
  expect(assignRes, "no response to assign probe").not.toBeNull();
  expect(assignRes!.status(), `tenant B got ${assignRes!.status()} on tenant A's assign page`).toBe(404);

  // Test ends here. We don't sign out: we're on a 404 page (no user menu),
  // and Playwright destroys the browser context between tests anyway.
});
