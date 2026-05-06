import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe slice of the Auth.js config. This file gets imported by middleware
 * (which runs in the Edge runtime where bcrypt and Postgres connections don't
 * work), so it must NOT import the database, the credentials provider, or
 * anything that pulls those in transitively.
 *
 * The full Node config (auth.ts) extends this with the Credentials provider
 * and the Drizzle adapter.
 */
export const authConfig = {
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/verify-email",
    error: "/sign-in",
  },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 }, // 30 days
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const path = nextUrl.pathname;
      const isAuthPath =
        path.startsWith("/app") ||
        path.startsWith("/onboarding") ||
        path.startsWith("/api/billing");
      if (isAuthPath && !isLoggedIn) {
        const url = new URL("/sign-in", nextUrl);
        url.searchParams.set("returnTo", path);
        return Response.redirect(url);
      }
      // /sign-in and /sign-up while signed in → bounce to /app
      if (
        isLoggedIn &&
        (path.startsWith("/sign-in") || path.startsWith("/sign-up"))
      ) {
        return Response.redirect(new URL("/app", nextUrl));
      }
      return true;
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
      }
      // Allow client to push activeTenantId updates via update() / useSession({ update })
      if (trigger === "update" && session?.activeTenantId !== undefined) {
        token.activeTenantId = session.activeTenantId;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.id && session.user) {
        session.user.id = token.id as string;
      }
      if (token?.activeTenantId !== undefined) {
        (session as { activeTenantId?: string | null }).activeTenantId =
          token.activeTenantId as string | null;
      }
      return session;
    },
  },
  providers: [], // populated in auth.ts
} satisfies NextAuthConfig;
