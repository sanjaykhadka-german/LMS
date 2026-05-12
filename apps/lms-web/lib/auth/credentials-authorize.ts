// Auth.js Credentials provider authorize() — extracted into a standalone
// function so vitest can invoke it directly without spinning up NextAuth's
// machinery. The Credentials provider in auth.ts simply delegates here.

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, lmsUsers, users } from "@tracey/db";
import { verifyPassword } from "./passwords";
import { tryLegacyAuth } from "./legacy-bridge";
import { isEffectivelyActive } from "~/lib/lms/employee-status";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});

export interface AuthorizedUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

/**
 * Verifies a (email, password) pair and returns the user record if both
 * the credentials check out AND the email has been verified. Returns null
 * for any failure (including malformed input). Throws `EmailNotVerified`
 * for the specific case of a known user whose email isn't confirmed yet —
 * the sign-in form surfaces that to the user.
 *
 * Resolution order:
 *   1. app.users row exists with bcrypt hash → verify, succeed if match.
 *      Membership is intentionally NOT required here. New Tracey signups
 *      have no app.members row until they finish /onboarding; blocking
 *      sign-in on missing membership permanently locks them out.
 *   2. Otherwise (no app.users row, or bcrypt mismatch) → tryLegacyAuth
 *      against public.users (Flask werkzeug hashes). On success the
 *      bridge provisions app.users + app.members and returns the new id.
 */
export async function authorizeCredentials(raw: unknown): Promise<AuthorizedUser | null> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { email, password } = parsed.data;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (user && user.passwordHash) {
    if (!user.emailVerified) {
      throw new Error("EmailNotVerified");
    }
    const bcryptOk = await verifyPassword(password, user.passwordHash);
    if (bcryptOk) {
      // Block sign-in if every linked employee row is deactivated/terminated.
      // Per-tenant gates (requireLearner/requireAdmin) already kick deactivated
      // users out of protected pages, but failing at auth-time gives a clear
      // message instead of a redirect-loop. If the user has no lmsUsers rows
      // (pure Tracey-only signup), nothing to gate on — let them through.
      const lmsRows = await db
        .select({
          isActiveFlag: lmsUsers.isActiveFlag,
          terminationDate: lmsUsers.terminationDate,
        })
        .from(lmsUsers)
        .where(eq(lmsUsers.traceyUserId, user.id));
      if (lmsRows.length > 0 && !lmsRows.some(isEffectivelyActive)) {
        throw new Error("AccountDeactivated");
      }
      return {
        id: user.id,
        name: user.name ?? null,
        email: user.email,
        image: user.image ?? null,
      };
    }
    // Bcrypt failed → likely they typed their original Flask password
    // against an orphaned signup row. Fall through to the bridge.
  }

  const legacy = await tryLegacyAuth(email, password);
  if (legacy) {
    return {
      id: legacy.id,
      name: legacy.name,
      email: legacy.email,
      image: null,
    };
  }

  return null;
}
