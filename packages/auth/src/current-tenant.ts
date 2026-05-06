import "server-only";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db, tenants, type Tenant } from "@tracey/db";

/**
 * Resolve the active Tracey tenant for the current request.
 *
 * Behaviour:
 * - Returns null if the user is not signed in or has no active organisation.
 * - Otherwise looks up the tenant row keyed on Clerk's `orgId`.
 * - If the row does not exist (first sight of this Clerk org), creates one
 *   with sensible defaults (free plan, 14-day trial) using the Clerk
 *   organisation's `name` and `slug`.
 *
 * Safe to call from Server Components, Route Handlers, and Server Actions.
 */
export async function currentTenant(): Promise<Tenant | null> {
  const { orgId } = await auth();
  if (!orgId) return null;

  const [existing] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.clerkOrgId, orgId))
    .limit(1);
  if (existing) return existing;

  const client = await clerkClient();
  const org = await client.organizations.getOrganization({ organizationId: orgId });

  const slug = org.slug ?? `org-${orgId.slice(-8).toLowerCase()}`;
  const name = org.name ?? slug;

  const [created] = await db
    .insert(tenants)
    .values({
      clerkOrgId: orgId,
      slug,
      name,
    })
    .onConflictDoNothing({ target: tenants.clerkOrgId })
    .returning();

  if (created) return created;

  const [refetched] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.clerkOrgId, orgId))
    .limit(1);
  if (!refetched) {
    throw new Error(`Failed to resolve or create tenant for Clerk org ${orgId}`);
  }
  return refetched;
}
