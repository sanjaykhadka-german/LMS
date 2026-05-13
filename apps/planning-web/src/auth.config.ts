import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe slice of the Auth.js config. Middleware runs in Edge runtime,
 * so this file must not import the database, the Credentials provider, or
 * anything that pulls those in transitively.
 *
 * The full Node config (auth.ts) extends this with the Credentials provider
 * and the Drizzle adapter.
 */
export const authConfig = {
  pages: {
    signIn: "/auth/login",
    error: "/auth/login",
  },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 }, // 30 days
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const path = nextUrl.pathname;
      const isAuthPage = path.startsWith("/auth/");
      const isApiRoute = path.startsWith("/api/");
      const isRootPath = path === "/";

      // API routes self-check; never redirect from middleware.
      if (isApiRoute) return true;

      const isPublic = isAuthPage || isRootPath;

      if (!isPublic && !isLoggedIn) {
        const url = new URL("/auth/login", nextUrl);
        return Response.redirect(url);
      }

      // Signed-in users hitting /auth/login bounce to /dashboard.
      // Don't bounce off accept-invite / change-password / reset-password —
      // those are flows that an authenticated user may still need to complete.
      if (
        isLoggedIn &&
        path.startsWith("/auth/login")
      ) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        token.passwordChangedAt = (user as { passwordChangedAt?: number })
          .passwordChangedAt;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.id && session.user) {
        session.user.id = token.id as string;
      }
      if (token?.passwordChangedAt !== undefined) {
        (session as { passwordChangedAt?: number }).passwordChangedAt =
          token.passwordChangedAt as number;
      }
      return session;
    },
  },
  providers: [], // populated in auth.ts
} satisfies NextAuthConfig;
