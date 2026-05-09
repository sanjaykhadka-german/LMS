import { NextResponse } from "next/server";
import { and, asc, eq, exists, ilike, or, sql } from "drizzle-orm";
import {
  forTenant,
  lmsContentItems,
  lmsDepartments,
  lmsEmployers,
  lmsMachines,
  lmsModules,
  lmsPositions,
  lmsUsers,
} from "@tracey/db";
import { getAuthorAccess } from "~/lib/auth/author";
import { tenantWhere } from "~/lib/lms/tenant-scope";

const LOOKUP_LIMIT = 5;
type LookupRow = { id: number; name: string };

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
  // search but modules were visible to all authors (app.py:1742). Same
  // gate applies to the lookup tables (departments, employers, machines,
  // positions) — those are admin-managed and never surfaced to qaqc.
  const includeUsers = access.membershipRole === "owner" || access.membershipRole === "admin";
  const includeAdminLookups = includeUsers;

  const tdb = forTenant(tid);
  const emptyLookup: LookupRow[] = [];
  const lookupQuery = (
    table: typeof lmsDepartments | typeof lmsEmployers | typeof lmsMachines | typeof lmsPositions,
  ) =>
    tdb.run((tx) =>
      tx
        .select({ id: table.id, name: table.name })
        .from(table)
        .where(and(tenantWhere(table, tid), ilike(table.name, like)))
        .orderBy(asc(table.name))
        .limit(LOOKUP_LIMIT),
    );
  const [userRows, moduleRows, departmentRows, employerRows, machineRows, positionRows] = await Promise.all([
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
    tdb.run((tx) => {
      // Match modules by their own title/description OR by any content_item
      // (lesson/section) under them whose title/body matches. Roll up to the
      // module — the result shape stays { id, title } so the search UI is
      // unchanged. Correlated EXISTS keeps the limit at 8 distinct modules.
      const contentMatches = tx
        .select({ x: sql`1` })
        .from(lmsContentItems)
        .where(
          and(
            eq(lmsContentItems.moduleId, lmsModules.id),
            tenantWhere(lmsContentItems, tid),
            or(
              ilike(lmsContentItems.title, like),
              ilike(lmsContentItems.body, like),
            ),
          ),
        );
      return tx
        .select({ id: lmsModules.id, title: lmsModules.title })
        .from(lmsModules)
        .where(
          and(
            tenantWhere(lmsModules, tid),
            or(
              ilike(lmsModules.title, like),
              ilike(lmsModules.description, like),
              exists(contentMatches),
            ),
          ),
        )
        .orderBy(asc(lmsModules.title))
        .limit(8);
    }),
    includeAdminLookups ? lookupQuery(lmsDepartments) : Promise.resolve(emptyLookup),
    includeAdminLookups ? lookupQuery(lmsEmployers) : Promise.resolve(emptyLookup),
    includeAdminLookups ? lookupQuery(lmsMachines) : Promise.resolve(emptyLookup),
    includeAdminLookups ? lookupQuery(lmsPositions) : Promise.resolve(emptyLookup),
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
    departments: departmentRows.map((d) => ({
      id: d.id,
      name: d.name,
      url: "/app/admin/departments",
    })),
    employers: employerRows.map((e) => ({
      id: e.id,
      name: e.name,
      url: "/app/admin/employers",
    })),
    machines: machineRows.map((m) => ({
      id: m.id,
      name: m.name,
      url: `/app/admin/machines/${m.id}/edit`,
    })),
    positions: positionRows.map((p) => ({
      id: p.id,
      name: p.name,
      url: `/app/admin/positions/${p.id}/edit`,
    })),
  });
}
