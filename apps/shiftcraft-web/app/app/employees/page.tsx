import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, members, users } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";

export const metadata = { title: "Employees · ShiftCraft" };

const ROLE_BADGE: Record<string, string> = {
  owner: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  admin: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  member: "bg-muted text-muted-foreground",
};

function initials(name: string | null, email: string): string {
  if (name && name.trim().length > 0) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (email[0] ?? "?").toUpperCase();
}

export default async function EmployeesPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const roster = await db
    .select({
      memberId: members.id,
      role: members.role,
      joinedAt: members.createdAt,
      userId: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.tenantId, membership.tenant.id))
    .orderBy(asc(users.name), asc(users.email));

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {roster.length} member{roster.length === 1 ? "" : "s"} of{" "}
          {membership.tenant.name}. Add or remove people from the LMS members
          page; they'll appear here for shift assignment.
        </p>
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {roster.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No members yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {roster.map((r) => (
              <li
                key={r.memberId}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {r.image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={r.image}
                      alt=""
                      className="h-9 w-9 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {initials(r.name, r.email)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {r.name ?? r.email}
                    </div>
                    {r.name && (
                      <div className="truncate text-xs text-muted-foreground">
                        {r.email}
                      </div>
                    )}
                  </div>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${ROLE_BADGE[r.role] ?? "bg-muted text-muted-foreground"}`}
                >
                  {r.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
