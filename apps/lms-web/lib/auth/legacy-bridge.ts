import "server-only";
import { eq } from "drizzle-orm";
import { db, lmsUsers, members, users } from "@tracey/db";
import { hashPassword, verifyWerkzeugPbkdf2 } from "./passwords";
import { logAuditEvent } from "~/lib/audit";

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
  if (!legacy.isActiveFlag) return null;

  // tracey_tenant_id is required so we know which workspace to add them
  // to. Slice 3's migration backfilled this on prod; if it's still NULL
  // we refuse rather than guess.
  if (!legacy.traceyTenantId) return null;

  // 2. Verify the password against werkzeug pbkdf2.
  if (!verifyWerkzeugPbkdf2(plaintext, legacy.passwordHash)) return null;

  // 3. Provision app.users + app.members + link tracey_user_id atomically.
  const bcryptHash = await hashPassword(plaintext);
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({
        email,
        name: legacy.name,
        passwordHash: bcryptHash,
        emailVerified: now,
      })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id, email: users.email, name: users.name });

    let userRow = inserted[0];
    if (!userRow) {
      // Lost a race: another sign-in for the same email created the row
      // first. Refetch — that path is the bcrypt fast-path on its second
      // hit so we should never actually need to run this branch outside
      // a true tab-spam scenario.
      const [existing] = await tx
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (!existing) {
        // Should not happen given the unique index, but be explicit.
        throw new Error("Legacy bridge: insert returned no row and refetch found nothing");
      }
      userRow = existing;
    } else {
      // Only create the membership row when WE created the user — if the
      // user already existed in Tracey for another tenant, their existing
      // memberships stand. Cross-workspace collisions are a known edge
      // case (see plan).
      await tx.insert(members).values({
        tenantId: legacy.traceyTenantId!,
        userId: userRow.id,
        role: "member",
      });
    }

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
  };
}
