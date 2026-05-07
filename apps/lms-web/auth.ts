import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  users,
  accounts,
  sessions,
  verificationTokens,
} from "@tracey/db";
import { authConfig } from "./auth.config";
import { verifyPassword } from "./lib/auth/passwords";
import { tryLegacyAuth, userHasAnyMembership } from "./lib/auth/legacy-bridge";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        // Existing Tracey user — bcrypt fast path. Only short-circuits when
        // both the password verifies AND the user has a workspace membership.
        // If either fails we fall through to the legacy bridge, which can
        // (a) verify against a Flask werkzeug hash if the bcrypt one is
        // stale and (b) repair an orphaned app.users row by upserting the
        // missing app.members entry. See lib/auth/legacy-bridge.ts.
        if (user && user.passwordHash) {
          if (!user.emailVerified) {
            throw new Error("EmailNotVerified");
          }
          const bcryptOk = await verifyPassword(password, user.passwordHash);
          if (bcryptOk) {
            const hasMembership = await userHasAnyMembership(user.id);
            if (hasMembership) {
              return {
                id: user.id,
                name: user.name ?? null,
                email: user.email,
                image: user.image ?? null,
              };
            }
            // Bcrypt verified but no membership → orphan. Fall through to
            // the legacy bridge so it can heal the row from public.users
            // (only works if they typed their Flask password). If they
            // typed the bcrypt-matching Tracey signup password, the bridge
            // will reject (werkzeug verify fails) and we return null —
            // the user must use their Flask password to recover.
          }
          // Bcrypt failed → likely they typed the original Flask password
          // against an orphaned signup row. Fall through to the bridge.
        }

        // Tracey row missing OR bcrypt failed OR orphan-no-membership.
        // tryLegacyAuth: if a Flask user with this email exists and the
        // password verifies as werkzeug (pbkdf2 or scrypt), upsert the
        // Tracey rows transparently and sign them in. Idempotent — safe to
        // re-run for accounts already partially provisioned.
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
      },
    }),
  ],
});
