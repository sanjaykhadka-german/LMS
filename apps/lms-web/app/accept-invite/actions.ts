"use server";

import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db, invitations, members, users } from "@tracey/db";
import { currentUser, setActiveTenant } from "~/lib/auth/current";

/**
 * Accept an invitation. Server action; expects `token` in form data.
 *
 * Caller MUST be signed in with the email the invitation was sent to.
 * The page-level guard already enforces this, but we re-check here in case
 * the form is replayed.
 */
export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) throw new Error("Missing token");

  const me = await currentUser();
  if (!me) {
    redirect(`/sign-in?returnTo=${encodeURIComponent(`/accept-invite?token=${token}`)}`);
  }

  const [inv] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.token, token))
    .limit(1);
  if (!inv) throw new Error("Invitation not found");
  if (inv.expiresAt.getTime() < Date.now()) {
    throw new Error("Invitation expired");
  }
  if (inv.email.toLowerCase() !== me.email.toLowerCase()) {
    throw new Error("Invitation email does not match the signed-in account");
  }

  // Idempotent: if a member row already exists, just switch to the tenant.
  const [existing] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.tenantId, inv.tenantId), eq(members.userId, me.id)))
    .limit(1);
  if (!existing) {
    await db.insert(members).values({
      tenantId: inv.tenantId,
      userId: me.id,
      role: inv.role,
    });
  }

  // Promote email-verified status if not already (the invitation email proves
  // ownership of the address).
  await db
    .update(users)
    .set({ emailVerified: new Date(), updatedAt: new Date() })
    .where(and(eq(users.id, me.id), isNull(users.emailVerified)));

  // Single-use: drop the invitation row so it can't be replayed.
  await db.delete(invitations).where(eq(invitations.id, inv.id));

  await setActiveTenant(inv.tenantId);
  redirect("/app");
}
