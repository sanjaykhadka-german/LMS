/**
 * Tenant resolution utilities.
 * Call getTenant() in any Server Component or Server Action to get
 * the current tenant's ID and metadata.
 */

import { headers } from "next/headers";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import type { Tenant } from "./types";

/**
 * Returns the tenant subdomain from the request header set by middleware.
 * Falls back to 'germanbutchery' in dev.
 */
export async function getTenantSubdomain(): Promise<string> {
  const h = await headers();
  return h.get("x-tracey-tenant") ?? "germanbutchery";
}

/**
 * Resolves the full tenant record from the subdomain.
 * Uses admin client (service role) so RLS doesn't block the lookup.
 */
export async function getTenant(): Promise<Tenant | null> {
  const subdomain = await getTenantSubdomain();
  const admin = createAdminClient();
  const { data } = await admin
    .from("tenants")
    .select("*")
    .eq("subdomain", subdomain)
    .eq("is_active", true)
    .single();
  return data ?? null;
}

/**
 * Returns just the tenant_id UUID, or null if not found.
 * Use this to scope queries in server components.
 */
export async function getTenantId(): Promise<string | null> {
  const tenant = await getTenant();
  return tenant?.id ?? null;
}

/**
 * Returns the current user's profile including tenant_id.
 */
export async function getCurrentProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  return profile;
}

/**
 * Convenience: returns both profile and tenant in one call.
 */
export async function getContext() {
  const [profile, tenant] = await Promise.all([getCurrentProfile(), getTenant()]);
  return { profile, tenant };
}
