// Auth.js Credentials authorize() for planning-web.
//
// Slice 0a transition strategy: Supabase Auth remains the source of truth for
// the password. signInWithPassword sets the Supabase session cookie via the
// SSR adapter so RLS-by-cookie data fetches in feature modules still work.
//
// Slice 0b extends the bootstrap: in addition to provisioning app.users, we
// also provision app.tenants (reusing the Supabase tenant UUID as the Tracey
// tenant id) and app.members so currentTenant() / requireTenant() resolve
// the user's workspace immediately. The Tracey user.id is also set to the
// Supabase auth.users.id on first insert so feature modules that still query
// `profiles.id = user.id` against Supabase continue to find the right row.

import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  users,
  tenants,
  members,
  type Role,
} from "@tracey/db";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashPassword, verifyPassword } from "./passwords";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export interface AuthorizedUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  passwordChangedAt: number;
}

// Planning-web profile roles vary across tenants (owner, admin, manager,
// operator, qaqc, viewer, …). Tracey enforces ('owner','admin','member')
// at the DB level — anything outside that triggers a CHECK constraint
// violation, so collapse the long tail into 'member'.
function mapToTraceyRole(supabaseRole: string | null | undefined): Role {
  if (supabaseRole === "owner") return "owner";
  if (supabaseRole === "admin") return "admin";
  return "member";
}

export async function authorizeCredentials(raw: unknown): Promise<AuthorizedUser | null> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { email, password } = parsed.data;

  // 1. Fast path: bcrypt against app.users.
  //    Once a user has signed in at least once (via this or any other Tracey
  //    app — lms-web, hub-web), app.users carries a bcrypt hash. Check it
  //    first so planning-web works in environments where Supabase env vars
  //    aren't set (and so the eventual Slice 15 cutover is mostly a no-op
  //    of removing the Supabase fallback below).
  const [appUserByEmail] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (appUserByEmail?.passwordHash) {
    const bcryptOk = await verifyPassword(password, appUserByEmail.passwordHash);
    if (bcryptOk) {
      // Best-effort: also sign into Supabase to refresh the SSR cookie so
      // legacy queries (still hitting Supabase in Phase 4 feature modules)
      // remain authenticated. Failures are non-fatal.
      const supabase = await createClient();
      const { data: sb } = await supabase.auth
        .signInWithPassword({ email, password })
        .catch(() => ({ data: { user: null } }));

      // Bootstrap tenant/members on demand if missing (idempotent).
      const [existingMembership] = await db
        .select({ id: members.id })
        .from(members)
        .where(eq(members.userId, appUserByEmail.id))
        .limit(1);
      if (!existingMembership && sb?.user) {
        await bootstrapTenantAndMembership(
          supabase,
          appUserByEmail.id,
          sb.user.id,
        ).catch(() => {});
      }

      return {
        id: appUserByEmail.id,
        name: appUserByEmail.name ?? null,
        email: appUserByEmail.email,
        image: appUserByEmail.image ?? null,
        passwordChangedAt: appUserByEmail.passwordChangedAt.getTime(),
      };
    }
  }

  // 2. Supabase fallback: verifies password and sets the SSR cookie.
  //    Used for planning-web users who haven't yet signed in to a Tracey
  //    app so don't have a bcrypt hash in app.users. Returns null if
  //    Supabase isn't configured (the env-guard stub returns the same
  //    "Supabase not configured" error shape that signInWithPassword does
  //    for invalid credentials).
  const supabase = await createClient();
  const { data: sb, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !sb?.user) return null;

  // 2b. Provision (or find) app.users. The Tracey user.id is set to the
  //     Supabase auth.users.id on first insert so feature modules that still
  //     query Supabase via `eq("id", user.id)` keep resolving the right row.
  const supabaseUserId = sb.user.id;
  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let appUser;
  if (existingUser) {
    appUser = existingUser;
  } else {
    const now = new Date();
    const bcryptHash = await hashPassword(password);
    const supabaseName =
      (sb.user.user_metadata && typeof sb.user.user_metadata === "object"
        ? ((sb.user.user_metadata as Record<string, unknown>).full_name as string | undefined) ??
          ((sb.user.user_metadata as Record<string, unknown>).name as string | undefined)
        : undefined) ?? null;
    const [inserted] = await db
      .insert(users)
      .values({
        id: supabaseUserId,
        email,
        name: supabaseName,
        passwordHash: bcryptHash,
        emailVerified: sb.user.email_confirmed_at
          ? new Date(sb.user.email_confirmed_at)
          : now,
        passwordChangedAt: now,
      })
      .returning();
    if (!inserted) return null;
    appUser = inserted;
  }

  // 2c. Ensure a tenant + membership exist for this user. Idempotent — if a
  //     membership row already exists we skip the lookup entirely. Otherwise
  //     read the Supabase profile to find the user's tenant_id + role and
  //     upsert into app.tenants / app.members.
  const [existingMembership] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.userId, appUser.id))
    .limit(1);

  if (!existingMembership) {
    await bootstrapTenantAndMembership(supabase, appUser.id, supabaseUserId);
  }

  return {
    id: appUser.id,
    name: appUser.name ?? null,
    email: appUser.email,
    image: appUser.image ?? null,
    passwordChangedAt: appUser.passwordChangedAt.getTime(),
  };
}

async function bootstrapTenantAndMembership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  appUserId: string,
  supabaseUserId: string,
): Promise<void> {
  // The Supabase profile row carries the tenant_id + role mapping that
  // planning-web has always relied on. RLS allows authenticated reads of
  // own-profile rows so the regular client works here.
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", supabaseUserId)
    .single();

  const tenantId = profile?.tenant_id as string | undefined;
  if (!tenantId) return; // No tenant — user can sign in but won't pass requireTenant() until an admin links them.

  // Tenant lookup uses the service-role client (matches the existing
  // @/lib/tenant.getTenant pattern) so we don't depend on Supabase RLS
  // policies around the tenants table.
  const [appTenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!appTenant) {
    const admin = createAdminClient();
    const { data: sbTenant } = await admin
      .from("tenants")
      .select("name, subdomain")
      .eq("id", tenantId)
      .single();

    if (sbTenant?.name) {
      const slug =
        (sbTenant.subdomain as string | undefined)?.trim() ||
        `tenant-${tenantId.slice(0, 8)}`;
      await db
        .insert(tenants)
        .values({
          id: tenantId,
          ownerUserId: appUserId,
          slug,
          name: sbTenant.name as string,
        })
        .onConflictDoNothing();
    }
  }

  await db
    .insert(members)
    .values({
      tenantId,
      userId: appUserId,
      role: mapToTraceyRole(profile?.role as string | null | undefined),
    })
    .onConflictDoNothing();
}
