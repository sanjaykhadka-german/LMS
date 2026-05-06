// Vestigial package — Auth.js helpers (currentUser, currentTenant, etc.)
// live in apps/lms-web/lib/auth/current.ts because they depend on the
// NextAuth instance defined in lms-web's auth.ts. This package now only
// re-exports types and shared role utilities so that future apps in this
// monorepo (tracey-planning, shift-craft) can share the same types.

export type { Role } from "@tracey/db";
export { requireRole } from "./require-role";
