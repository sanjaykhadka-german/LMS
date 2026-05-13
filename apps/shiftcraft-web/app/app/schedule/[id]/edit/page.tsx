import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scLocations,
  scShiftAssignments,
  scShifts,
  users,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { ShiftForm } from "../../_form";
import {
  cancelShiftAction,
  deleteShiftAction,
  publishShiftAction,
  unassignAction,
} from "../../actions";
import { AssignForm } from "../../_assign-form";

export const metadata = { title: "Edit shift · ShiftCraft" };

// Convert a Date to YYYY-MM-DDTHH:mm in the user's local tz (what
// <input type="datetime-local"> expects).
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const ASSIGN_BADGE: Record<string, string> = {
  offered: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  accepted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  declined: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  swapped: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  no_show: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

export default async function EditShiftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const isAdmin = membership.role === "admin" || membership.role === "owner";

  const ctx = forTenant(membership.tenant.id);
  const [shiftRow] = await ctx.run((tx) =>
    tx
      .select({
        id: scShifts.id,
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        status: scShifts.status,
        notes: scShifts.notes,
      })
      .from(scShifts)
      .where(
        and(eq(scShifts.id, id), eq(scShifts.traceyTenantId, membership.tenant.id)),
      )
      .limit(1),
  );

  if (!shiftRow) notFound();

  const [locations, assignments, tenantMembers] = await Promise.all([
    ctx.run((tx) =>
      tx
        .select({ id: scLocations.id, name: scLocations.name })
        .from(scLocations)
        .orderBy(asc(scLocations.name)),
    ),
    ctx.run((tx) =>
      tx
        .select({
          id: scShiftAssignments.id,
          userId: scShiftAssignments.userId,
          status: scShiftAssignments.status,
          respondedAt: scShiftAssignments.respondedAt,
          createdAt: scShiftAssignments.createdAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(scShiftAssignments)
        .leftJoin(users, eq(users.id, scShiftAssignments.userId))
        .where(eq(scShiftAssignments.shiftId, id))
        .orderBy(asc(scShiftAssignments.createdAt)),
    ),
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(eq(members.tenantId, membership.tenant.id))
      .orderBy(asc(users.name), asc(users.email)),
  ]);

  const assignedIds = new Set(assignments.map((a) => a.userId));
  const availableEmployees = tenantMembers.filter((m) => !assignedIds.has(m.id));

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Edit shift</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Status: <span className="font-medium capitalize">{shiftRow.status}</span>
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/schedule">← Back</Link>
        </Button>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <ShiftForm
          mode="edit"
          shiftId={shiftRow.id}
          locations={locations}
          defaultValues={{
            locationId: shiftRow.locationId,
            role: shiftRow.role,
            startsAt: toLocalInput(shiftRow.startsAt),
            endsAt: toLocalInput(shiftRow.endsAt),
            notes: shiftRow.notes,
          }}
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold">
          Assignments ({assignments.length})
        </h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          Offers start as "offered". Employees accept or decline from their own
          shifts page.
        </p>

        {assignments.length === 0 ? (
          <p className="mb-4 text-sm text-muted-foreground">
            No one is assigned yet.
          </p>
        ) : (
          <ul className="mb-4 divide-y divide-border">
            {assignments.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {a.userName ?? a.userEmail ?? "Unknown"}
                  </div>
                  {a.respondedAt && (
                    <div className="text-xs text-muted-foreground">
                      Responded {a.respondedAt.toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${ASSIGN_BADGE[a.status] ?? ""}`}
                  >
                    {a.status.replace("_", " ")}
                  </span>
                  {isAdmin && (
                    <form action={unassignAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="shiftId" value={shiftRow.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10"
                      >
                        Unassign
                      </Button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {isAdmin && (
          <AssignForm
            shiftId={shiftRow.id}
            availableEmployees={availableEmployees}
          />
        )}
      </section>

      <section className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-5 shadow-sm">
        {shiftRow.status !== "published" && (
          <form action={publishShiftAction}>
            <input type="hidden" name="id" value={shiftRow.id} />
            <Button type="submit" variant="outline" size="sm">
              Publish
            </Button>
          </form>
        )}
        {shiftRow.status !== "cancelled" && (
          <form action={cancelShiftAction}>
            <input type="hidden" name="id" value={shiftRow.id} />
            <Button type="submit" variant="outline" size="sm">
              Cancel shift
            </Button>
          </form>
        )}
        <form action={deleteShiftAction} className="ml-auto">
          <input type="hidden" name="id" value={shiftRow.id} />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            Delete
          </Button>
        </form>
      </section>
    </div>
  );
}
