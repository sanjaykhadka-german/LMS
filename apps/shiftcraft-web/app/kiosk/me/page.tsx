import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  forTenant,
  scAnnouncements,
  scClockEvents,
  scKioskDevices,
  scLocations,
  scShiftAssignments,
  scShifts,
  users,
} from "@tracey/db";
import {
  KIOSK_ACTOR_COOKIE,
  KIOSK_DEVICE_COOKIE,
  verifyActorCookie,
  verifyDeviceCookie,
} from "~/lib/kiosk/cookies";
import { deriveClockState, type ClockStatus } from "~/lib/clock";
import { PunchScreen, type PunchScreenProps } from "./_punch";

export const metadata = { title: "Kiosk · Punch" };
export const dynamic = "force-dynamic";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday(): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}

export default async function KioskMePage() {
  const cookieStore = await cookies();
  const deviceClaim = verifyDeviceCookie(
    cookieStore.get(KIOSK_DEVICE_COOKIE)?.value,
  );
  const actorClaim = verifyActorCookie(
    cookieStore.get(KIOSK_ACTOR_COOKIE)?.value,
  );
  if (
    !deviceClaim ||
    !actorClaim ||
    actorClaim.deviceId !== deviceClaim.deviceId
  ) {
    redirect("/kiosk");
  }

  const tenantId = deviceClaim.tenantId;
  const locationId = deviceClaim.locationId;
  const appUserId = actorClaim.appUserId;
  const today = startOfToday();
  const tomorrow = endOfToday();

  // User profile from the shared app schema. Always present (FK guarantees
  // it exists because the PIN row references app.users on delete cascade).
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(users)
    .where(eq(users.id, appUserId))
    .limit(1);
  if (!user) redirect("/kiosk");

  // Everything else lives in the per-tenant schema.
  const [
    deviceRows,
    locationRows,
    todayUserEvents,
    todayTenantEvents,
    todayShifts,
    pinnedAnnouncementRows,
  ] = await Promise.all([
    forTenant(tenantId).run((tx) =>
      tx
        .select({ requireSelfie: scKioskDevices.requireSelfie })
        .from(scKioskDevices)
        .where(eq(scKioskDevices.id, deviceClaim.deviceId))
        .limit(1),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({ name: scLocations.name })
        .from(scLocations)
        .where(eq(scLocations.id, locationId))
        .limit(1),
    ),
    // Today's events for this user — drives current clock state and the
    // valid-transitions for the punch buttons.
    forTenant(tenantId).run((tx) =>
      tx
        .select()
        .from(scClockEvents)
        .where(
          and(
            eq(scClockEvents.appUserId, appUserId),
            gte(scClockEvents.occurredAt, today),
            lt(scClockEvents.occurredAt, tomorrow),
          ),
        )
        .orderBy(asc(scClockEvents.occurredAt)),
    ),
    // Today's events across the whole tenant — used to compute the
    // "who's here now at this location" wall.
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          appUserId: scClockEvents.appUserId,
          eventType: scClockEvents.eventType,
          locationId: scClockEvents.locationId,
          occurredAt: scClockEvents.occurredAt,
        })
        .from(scClockEvents)
        .where(
          and(
            gte(scClockEvents.occurredAt, today),
            lt(scClockEvents.occurredAt, tomorrow),
          ),
        )
        .orderBy(asc(scClockEvents.occurredAt)),
    ),
    // Today's accepted shifts for this user at this location.
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          startsAt: scShifts.startsAt,
          endsAt: scShifts.endsAt,
          role: scShifts.role,
        })
        .from(scShiftAssignments)
        .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
        .where(
          and(
            eq(scShiftAssignments.userId, appUserId),
            eq(scShiftAssignments.status, "accepted"),
            eq(scShifts.locationId, locationId),
            gte(scShifts.startsAt, today),
            lt(scShifts.startsAt, tomorrow),
          ),
        )
        .orderBy(asc(scShifts.startsAt)),
    ),
    // Top pinned announcement, if any. v1 shows it on every visit (no
    // per-user read-tracking yet — see plan's "out of scope" notes).
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          title: scAnnouncements.title,
          body: scAnnouncements.body,
        })
        .from(scAnnouncements)
        .where(
          and(
            eq(scAnnouncements.traceyTenantId, tenantId),
            eq(scAnnouncements.pinned, true),
            or(
              isNull(scAnnouncements.expiresAt),
              sql`${scAnnouncements.expiresAt} > now()`,
            ),
          ),
        )
        .orderBy(sql`${scAnnouncements.createdAt} desc`)
        .limit(1),
    ),
  ]);

  const requireSelfie = deviceRows[0]?.requireSelfie ?? true;
  const locationName = locationRows[0]?.name ?? "—";

  const clockState = deriveClockState(todayUserEvents);

  // Build the "who's here now at this location" set. Walk today's tenant
  // events grouped by user; if the latest is `in` or `break_end` AND the
  // location matches our kiosk, the user is currently on-shift here.
  const lastByUser = new Map<
    string,
    { eventType: string; locationId: string | null; occurredAt: Date }
  >();
  for (const e of todayTenantEvents) {
    lastByUser.set(e.appUserId, e);
  }
  const hereUserIds: string[] = [];
  for (const [uid, last] of lastByUser.entries()) {
    if (
      (last.eventType === "in" || last.eventType === "break_end") &&
      last.locationId === locationId
    ) {
      hereUserIds.push(uid);
    }
  }
  let whosHere: PunchScreenProps["whosHere"] = [];
  if (hereUserIds.length > 0) {
    const peopleRows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
      })
      .from(users)
      .where(sql`${users.id} in ${hereUserIds}`);
    whosHere = peopleRows.map((p) => ({
      id: p.id,
      name: p.name ?? p.email ?? "—",
      image: p.image,
      since: lastByUser.get(p.id)!.occurredAt.toISOString(),
    }));
    whosHere.sort((a, b) =>
      a.since.localeCompare(b.since),
    );
  }

  const todayShift = todayShifts[0]
    ? {
        startsAt: todayShifts[0].startsAt.toISOString(),
        endsAt: todayShifts[0].endsAt.toISOString(),
        role: todayShifts[0].role,
      }
    : null;

  const announcement = pinnedAnnouncementRows[0] ?? null;

  // Pass the last event type to the client component so it can compute
  // valid transitions client-side without another roundtrip per button.
  const lastEventType =
    todayUserEvents.length > 0
      ? (todayUserEvents[todayUserEvents.length - 1]!.eventType as
          | "in"
          | "out"
          | "break_start"
          | "break_end")
      : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <PunchScreen
        user={{
          name: user.name ?? user.email ?? "—",
          image: user.image,
        }}
        clockStatus={clockState.status as ClockStatus}
        lastEventType={lastEventType}
        segmentStartedAt={clockState.segmentStartedAt?.toISOString() ?? null}
        locationName={locationName}
        todayShift={todayShift}
        whosHere={whosHere}
        announcement={announcement}
        requireSelfie={requireSelfie}
      />
    </main>
  );
}
