import "server-only";
import { eq } from "drizzle-orm";
import { db, lmsUsers, members, users, type Role } from "@tracey/db";
import { hashPassword, verifyLegacyHash } from "./passwords";
import { logAuditEvent } from "~/lib/audit";
import { isEffectivelyActive } from "~/lib/lms/employee-status";

// Flask roles: employee | qaqc | admin (free-text on lmsUsers.role).
// Tracey roles: owner | admin | member (enum on app.members.role).
// QA/QC has no Tracey equivalent — collapse it into admin so QA/QC users
// keep author-level access. Schema migration to extend the enum is deferred.
export function mapFlaskRole(flaskRole: string | null | undefined): Role {
  if (flaskRole === "admin" || flaskRole === "qaqc") return "admin";
  return "member";
}

// Slice 6 — transparent migration of legacy Flask users into Tracey on
// first sign-in. Auth.js's credentials provider calls tryLegacyAuth() when
// app.users has no row for the supplied email. If public.users (Flask)
// does have a matching row and the pbkdf2 hash verifies, we mint the
// Tracey rows + link them, then return the new user so Auth.js issues a
// session as if the user had just signed up.

export interface BridgedUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: Date;
  passwordChangedAt: number; // epoch ms
}

export async function tryLegacyAuth(
  email: string,
  plaintext: string,
): Promise<BridgedUser | null> {
  // 1. Look up the Flask row.
  const [legacy] = await db
    .select()
    .from(lmsUsers)
    .where(eq(lmsUsers.email, email))
    .limit(1);
  if (!legacy) return null;
  if (!isEffectivelyActive(legacy)) return null;

  // tracey_tenant_id is required so we know which workspace to add them
  // to. Slice 3's migration backfilled this on prod; if it's still NULL
  // we refuse rather than guess.
  if (!legacy.traceyTenantId) return null;

  // 2. Verify the password. verifyLegacyHash accepts both werkzeug
  //    (pbkdf2:sha256:, scrypt:) AND bcrypt — the latter is what
  //    createEmployeeAction / resetEmployeePasswordAction write directly
  //    into public.users for admin-invited employees.
  if (!(await verifyLegacyHash(plaintext, legacy.passwordHash))) return null;

  // 3. Provision app.users + app.members + link tracey_user_id atomically.
  const bcryptHash = await hashPassword(plaintext);
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    // Upsert: if an app.users row exists for this email (abandoned signup,
    // race, or historical drift), realign its credential-bearing fields to
    // what we just verified against the legacy hash. Leaves `name` alone so
    // a user-customised Tracey display name isn't overwritten on every
    // legacy fallback.
    const inserted = await tx
      .insert(users)
      .values({
        email,
        name: legacy.name,
        passwordHash: bcryptHash,
        emailVerified: now,
        passwordChangedAt: now,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          passwordHash: bcryptHash,
          emailVerified: now,
          passwordChangedAt: now,
          updatedAt: now,
        },
      })
      .returning({ id: users.id, email: users.email, name: users.name });

    const userRow = inserted[0];
    if (!userRow) {
      throw new Error("Legacy bridge: upsert returned no row");
    }

    // Idempotent: only inserts when no membership for this (tenant, user)
    // pair exists. Existing memberships in OTHER tenants are untouched.
    await tx
      .insert(members)
      .values({
        tenantId: legacy.traceyTenantId!,
        userId: userRow.id,
        role: mapFlaskRole(legacy.role),
      })
      .onConflictDoNothing({ target: [members.tenantId, members.userId] });

    // Always link the Flask row to the Tracey id (idempotent).
    await tx
      .update(lmsUsers)
      .set({ traceyUserId: userRow.id })
      .where(eq(lmsUsers.id, legacy.id));

    return userRow;
  });

  // Best-effort audit log; never blocks sign-in.
  void logAuditEvent({
    tenantId: legacy.traceyTenantId,
    actorUserId: result.id,
    actorEmail: result.email,
    action: "auth.legacy_migrated",
    targetKind: "user",
    targetId: result.id,
    details: { lmsUserId: legacy.id },
  });

  return {
    id: result.id,
    email: result.email,
    name: result.name ?? legacy.name,
    emailVerified: now,
    passwordChangedAt: now.getTime(),
  };
}
