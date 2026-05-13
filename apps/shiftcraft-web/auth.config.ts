import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const path = nextUrl.pathname;
      const isAppPath = path.startsWith("/app");
      if (isAppPath && !isLoggedIn) {
        const url = new URL("/sign-in", nextUrl);
        url.searchParams.set("returnTo", path);
        return Response.redirect(url);
      }
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
        token.passwordChangedAt = (user as { passwordChangedAt?: number })
          .passwordChangedAt;
      }
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
      if (token?.passwordChangedAt !== undefined) {
        (session as { passwordChangedAt?: number }).passwordChangedAt =
          token.passwordChangedAt as number;
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
