import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import {
  forTenant,
  scKioskDevices,
  scLocations,
  tenants,
  db,
} from "@tracey/db";
import {
  KIOSK_DEVICE_COOKIE,
  verifyDeviceCookie,
} from "~/lib/kiosk/cookies";

export const metadata = { title: "Kiosk" };
// The kiosk surface is always fresh — clock state, who's-here, last-seen
// timestamps. Disable Next's static generation for this route group.
export const dynamic = "force-dynamic";

interface PairedState {
  tenantName: string;
  locationName: string;
  requireSelfie: boolean;
}

// Resolves the device cookie into the live device + location row. Returns
// null if the cookie is missing, signature-invalid, the device was revoked,
// or the row is gone entirely (admin deleted it). Also bumps last_seen_at
// as a side effect so the admin device list shows "online".
async function resolvePairing(): Promise<PairedState | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(KIOSK_DEVICE_COOKIE)?.value;
  const claim = verifyDeviceCookie(raw);
  if (!claim) return null;

  const rows = await forTenant(claim.tenantId).run((tx) =>
    tx
      .select({
        deviceId: scKioskDevices.id,
        requireSelfie: scKioskDevices.requireSelfie,
        locationName: scLocations.name,
      })
      .from(scKioskDevices)
      .leftJoin(scLocations, eq(scLocations.id, scKioskDevices.locationId))
      .where(
        and(
          eq(scKioskDevices.id, claim.deviceId),
          eq(scKioskDevices.traceyTenantId, claim.tenantId),
          isNull(scKioskDevices.revokedAt),
        ),
      )
      .limit(1),
  );
  const device = rows[0];
  if (!device) return null;

  // Bump last_seen_at so admins can spot offline devices. Fire-and-forget;
  // a failure here mustn't block the kiosk render.
  await forTenant(claim.tenantId)
    .run((tx) =>
      tx
        .update(scKioskDevices)
        .set({ lastSeenAt: new Date() })
        .where(eq(scKioskDevices.id, claim.deviceId)),
    )
    .catch((err) => console.error("[kiosk] last_seen bump failed:", err));

  // Tenant name comes from the shared app schema, not the per-tenant
  // schema. One small extra query — cheap.
  const [tenantRow] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, claim.tenantId))
    .limit(1);

  return {
    tenantName: tenantRow?.name ?? "Workspace",
    locationName: device.locationName ?? "—",
    requireSelfie: device.requireSelfie,
  };
}

function errorMessage(reason: string | undefined): string | null {
  if (!reason) return null;
  switch (reason) {
    case "bad_link":
      return "That pairing link wasn't valid. Ask a manager for a new one.";
    case "code_invalid":
      return "Pairing code was wrong, expired, or already used. Ask a manager to generate a new one.";
    default:
      return "Pairing didn't work. Ask a manager for a new code.";
  }
}

export default async function KioskHome({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errMsg = errorMessage(error);
  const paired = await resolvePairing();

  if (!paired) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/80 p-8 text-center shadow-xl">
          <h1 className="text-2xl font-semibold tracking-tight">
            Kiosk not paired
          </h1>
          <p className="text-sm text-zinc-400">
            This device isn't registered yet. A manager needs to pair it
            from the admin app:
          </p>
          <ol className="space-y-1 rounded-md bg-zinc-950 px-4 py-3 text-left text-xs text-zinc-300">
            <li>1. Sign in at the main app</li>
            <li>2. Go to Kiosks → Add a kiosk</li>
            <li>3. Open the pairing link on this device</li>
          </ol>
          {errMsg ? (
            <p className="rounded-md border border-amber-900/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
              {errMsg}
            </p>
          ) : null}
        </div>
      </main>
    );
  }

  // Paired but no numpad yet — Slice 5 will replace this placeholder with
  // the real PIN entry experience.
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-lg space-y-3 text-center">
        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          {paired.tenantName}
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">
          {paired.locationName}
        </h1>
        <p className="text-sm text-zinc-400">
          Kiosk paired. PIN entry arrives in the next update.
        </p>
        {paired.requireSelfie ? (
          <p className="text-xs text-zinc-500">
            Selfie required on clock-in / clock-out.
          </p>
        ) : (
          <p className="text-xs text-zinc-500">
            Selfie disabled on this device.
          </p>
        )}
      </div>
    </main>
  );
}
