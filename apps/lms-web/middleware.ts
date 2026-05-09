import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Edge-safe Auth.js instance — uses `authConfig` only (no Credentials
// provider, no DB adapter). The `authorized` callback in authConfig handles
// the redirect logic for protected routes.
export const { auth: middleware } = NextAuth(authConfig);

export default middleware((req) => {
  // Forward the request pathname so server components can read it via
  // headers() — used by /app/layout.tsx to skip the billing gate when the
  // user is already on /app/billing or /app/account (avoids redirect loops).
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
