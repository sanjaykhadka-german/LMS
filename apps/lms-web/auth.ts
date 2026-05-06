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
        if (!user || !user.passwordHash) return null;
        if (!user.emailVerified) {
          // Surfacing a typed error is awkward in v5; we throw to render the
          // sign-in page's "verify your email" CTA via ?error=Verification.
          throw new Error("EmailNotVerified");
        }

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          name: user.name ?? null,
          email: user.email,
          image: user.image ?? null,
        };
      },
    }),
  ],
});
