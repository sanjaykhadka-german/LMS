import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { forTenant, scTimeOffRequests, users } from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { TimeOffForm } from "./_form";
import {
  approveTimeOffAction,
  cancelOwnTimeOffAction,
  denyTimeOffAction,
} from "./actions";

export const metadata = { title: "Time off · ShiftCraft" };

type Filter = "pending" | "approved" | "denied" | "cancelled" | "all";
const FILTERS: Filter[] = ["pending", "approved", "denied", "cancelled", "all"];

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-500 text-white",
  approved: "bg-emerald-600 text-white",
  denied: "bg-rose-600 text-white",
  cancelled: "bg-slate-500 text-white line-through",
};

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function TimeOffPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const user = await requireUser();

  const { status: rawStatus } = await searchParams;
  const filter: Filter = (FILTERS as string[]).includes(rawStatus ?? "")
    ? (rawStatus as Filter)
    : "pending";

  const isAdmin = membership.role === "admin" || membership.role === "owner";

  const rows = await forTenant(membership.tenant.id).run((tx) => {
    const q = tx
      .select({
        id: scTimeOffRequests.id,
        userId: scTimeOffRequests.userId,
        startDate: scTimeOffRequests.startDate,
        endDate: scTimeOffRequests.endDate,
        reason: scTimeOffRequests.reason,
        status: scTimeOffRequests.status,
        createdAt: scTimeOffRequests.createdAt,
        userName: users.name,
        userEmail: users.email,
      })
      .from(scTimeOffRequests)
      .leftJoin(users, eq(users.id, scTimeOffRequests.userId))
      .where(
        filter === "all"
          ? eq(scTimeOffRequests.traceyTenantId, membership.tenant.id)
          : and(
              eq(scTimeOffRequests.traceyTenantId, membership.tenant.id),
              eq(scTimeOffRequests.status, filter),
            ),
      )
      .orderBy(desc(scTimeOffRequests.createdAt));
    return q;
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Time off</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin
            ? "Review pending requests and submit your own."
            : "Submit a request, then track its status here."}
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold">Submit a request</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          {isAdmin
            ? "Admins can also submit on behalf of themselves."
            : "Your manager will review and approve or deny."}
        </p>
        <TimeOffForm />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Button
            asChild
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
          >
            <Link href={`/app/time-off?status=${f}`}>
              {f === "all" ? "All" : f[0]!.toUpperCase() + f.slice(1)}
            </Link>
          </Button>
        ))}
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No {filter === "all" ? "" : filter} requests.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const isOwn = r.userId === user.id;
              const canReview = isAdmin && r.status === "pending";
              const canCancel = isOwn && r.status === "pending";
              return (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {r.userName ?? r.userEmail ?? "Unknown"}
                        {isOwn && (
                          <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                            You
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-sm">
                        {fmtDate(r.startDate)} → {fmtDate(r.endDate)}
                      </div>
                      {r.reason && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {r.reason}
                        </div>
                      )}
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_BADGE[r.status] ?? ""}`}
                    >
                      {r.status}
                    </span>
                  </div>

                  {(canReview || canCancel) && (
                    <div className="mt-3 flex items-center gap-2">
                      {canReview && (
                        <>
                          <form action={approveTimeOffAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <Button type="submit" size="sm" variant="outline">
                              Approve
                            </Button>
                          </form>
                          <form action={denyTimeOffAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              className="border-destructive/40 text-destructive hover:bg-destructive/10"
                            >
                              Deny
                            </Button>
                          </form>
                        </>
                      )}
                      {canCancel && (
                        <form action={cancelOwnTimeOffAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <Button type="submit" size="sm" variant="ghost">
                            Cancel
                          </Button>
                        </form>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
