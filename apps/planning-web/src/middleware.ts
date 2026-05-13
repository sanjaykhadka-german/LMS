import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Edge-safe Auth.js instance — `authConfig` only (no Credentials provider,
// no DB adapter). The `authorized` callback handles redirect-to-login for
// protected routes.
export const { auth: middleware } = NextAuth(authConfig);

export default middleware((req) => {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);

  // Preserve planning-web's existing subdomain → tenant header contract so
  // getTenantSubdomain() / getTenant() in @/lib/tenant still resolve.
  // Slice 0b replaces this with the Tracey active-tenant cookie + members lookup.
  const host = req.headers.get("host") ?? "";
  let subdomain = req.cookies.get("tracey-tenant")?.value ?? null;
  if (!subdomain) {
    const parts = host.split(".");
    subdomain = parts.length >= 3 ? (parts[0] ?? "germanbutchery") : "germanbutchery";
  }
  headers.set("x-tracey-tenant", subdomain);

  return NextResponse.next({ request: { headers } });
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
