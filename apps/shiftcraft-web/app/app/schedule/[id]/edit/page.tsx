import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { forTenant, scLocations, scShifts } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { ShiftForm } from "../../_form";
import {
  cancelShiftAction,
  deleteShiftAction,
  publishShiftAction,
} from "../../actions";

export const metadata = { title: "Edit shift · ShiftCraft" };

// Convert a Date to YYYY-MM-DDTHH:mm in the user's local tz (what
// <input type="datetime-local"> expects).
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function EditShiftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await currentMembership();
  if (!membership) redirect("/app");

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

  const locations = await ctx.run((tx) =>
    tx
      .select({ id: scLocations.id, name: scLocations.name })
      .from(scLocations)
      .orderBy(asc(scLocations.name)),
  );

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
