import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Edge-safe Auth.js instance — uses `authConfig` only (no Credentials
// provider, no DB adapter). The `authorized` callback in authConfig handles
// the redirect logic for protected routes.
export const { auth: middleware } = NextAuth(authConfig);

export default middleware((_req) => {
  // The `authorized` callback already handled redirects; reaching here means
  // the request is allowed.
  return undefined;
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
