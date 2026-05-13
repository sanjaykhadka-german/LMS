/**
 * Tenant resolution utilities.
 *
 * Slice 0b switched the source of truth from Supabase's `public.tenants`
 * (resolved by host subdomain) to the Tracey `app.tenants` table, accessed
 * via @/lib/auth/current's cookie + members lookup. Function signatures
 * stay back-compat so the existing call sites in feature modules keep
 * working — every existing `getTenantId()` consumer still receives the
 * tenant UUID, which is preserved across the bootstrap (Tracey app.tenants.id
 * = the original Supabase public.tenants.id).
 *
 * `getCurrentProfile()` still hits Supabase because the `profiles` table
 * isn't migrated until a later slice. Now that the Tracey user.id mirrors
 * the Supabase auth.users.id (Slice 0b bootstrap), the existing
 * `eq("id", user.id)` filter resolves correctly.
 */

import { createClient } from "./supabase/server";
import { currentTenant, currentUser, type Tenant } from "@/lib/auth/current";

export type { Tenant };

export async function getTenant(): Promise<Tenant | null> {
  return currentTenant();
}

export async function getTenantId(): Promise<string | null> {
  const tenant = await currentTenant();
  return tenant?.id ?? null;
}

/**
 * Back-compat shim — returns the tenant's slug, which under the Tracey model
 * corresponds to what used to be the Supabase tenant subdomain. No callers
 * use this in the planning-web codebase today (verified by grep); kept only
 * so future ports of legacy code don't break silently.
 */
export async function getTenantSubdomain(): Promise<string> {
  const tenant = await currentTenant();
  return tenant?.slug ?? "germanbutchery";
}

export async function getCurrentProfile() {
  const u = await currentUser();
  if (!u) return null;
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", u.id)
    .single();
  return profile;
}

export async function getContext() {
  const [profile, tenant] = await Promise.all([getCurrentProfile(), getTenant()]);
  return { profile, tenant };
}
