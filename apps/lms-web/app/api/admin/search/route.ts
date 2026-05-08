import { NextResponse } from "next/server";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { forTenant, lmsModules, lmsUsers } from "@tracey/db";
import { getAuthorAccess } from "~/lib/auth/author";
import { tenantWhere } from "~/lib/lms/tenant-scope";

// GET /api/admin/search?q=<term>
// Mirrors Flask's /admin/search (app.py:1719-1762): users + modules in the
// active tenant, ilike across name/email/title, capped at 8 each.
export async function GET(req: Request) {
  const access = await getAuthorAccess();
  if (!access) return new NextResponse("Unauthorized", { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ users: [], modules: [] });
  }

  const like = `%${q}%`;
  const tid = access.traceyTenantId;

  // Tracey 'admin'/'owner' see users; lmsRole='qaqc' (member-tier) does
  // not — matches Flask, where `current_user.is_admin` gated the user
  // search but modules were visible to all authors (app.py:1742).
  const includeUsers = access.membershipRole === "owner" || access.membershipRole === "admin";

  const tdb = forTenant(tid);
  const [userRows, moduleRows] = await Promise.all([
    includeUsers
      ? tdb.run((tx) =>
          tx
            .select({
              id: lmsUsers.id,
              name: lmsUsers.name,
              email: lmsUsers.email,
            })
            .from(lmsUsers)
            .where(
              and(
                tenantWhere(lmsUsers, tid),
                eq(lmsUsers.isActiveFlag, true),
                or(
                  ilike(lmsUsers.name, like),
                  ilike(lmsUsers.firstName, like),
                  ilike(lmsUsers.lastName, like),
                  ilike(lmsUsers.email, like),
                ),
              ),
            )
            .orderBy(asc(lmsUsers.name))
            .limit(8),
        )
      : Promise.resolve([] as Array<{ id: number; name: string; email: string }>),
    tdb.run((tx) =>
      tx
        .select({ id: lmsModules.id, title: lmsModules.title })
        .from(lmsModules)
        .where(and(tenantWhere(lmsModules, tid), ilike(lmsModules.title, like)))
        .orderBy(asc(lmsModules.title))
        .limit(8),
    ),
  ]);

  return NextResponse.json({
    users: userRows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      url: `/app/admin/employees/${u.id}/edit`,
    })),
    modules: moduleRows.map((m) => ({
      id: m.id,
      title: m.title,
      url: `/app/admin/modules/${m.id}`,
    })),
  });
}
