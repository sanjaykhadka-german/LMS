import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, members, users } from "@tracey/db";

// Returns owner+admin email addresses for the given tenant. Empty when the
// tenant has no admins (shouldn't happen post-onboarding, but defended
// against by callers).
export async function getTenantAdminEmails(tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(
      and(
        eq(members.tenantId, tenantId),
        inArray(members.role, ["owner", "admin"]),
      ),
    );
  return [...new Set(rows.map((r) => r.email))];
}
