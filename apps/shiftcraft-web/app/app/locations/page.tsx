import Link from "next/link";
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { forTenant, scLocations } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { LocationForm } from "./_form";

export const metadata = { title: "Locations · ShiftCraft" };

export default async function LocationsPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const locations = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        id: scLocations.id,
        name: scLocations.name,
        timezone: scLocations.timezone,
        address: scLocations.address,
      })
      .from(scLocations)
      .orderBy(asc(scLocations.name)),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Locations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sites where shifts happen. Add a location before scheduling shifts.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold">Add a location</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          Timezone affects how shift times display for staff at that site.
        </p>
        <LocationForm mode="create" />
      </section>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            All locations ({locations.length})
          </h2>
        </div>
        {locations.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No locations yet — add one above.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {locations.map((loc) => (
              <li
                key={loc.id}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{loc.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {loc.timezone}
                    {loc.address ? ` · ${loc.address}` : ""}
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/app/locations/${loc.id}/edit`}>Edit</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
