"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { forTenant, scEmployeePins } from "@tracey/db";
import { verifyPassword } from "~/lib/auth/passwords";
import {
  KIOSK_ACTOR_COOKIE,
  KIOSK_COOKIE_OPTS,
  KIOSK_DEVICE_COOKIE,
  signActorCookie,
  verifyDeviceCookie,
} from "~/lib/kiosk/cookies";

// In-memory rate-limit window per device. Single-instance memory is fine
// because every kiosk talks to one app instance (each kiosk tablet has a
// pinned origin) and the limit is a UX guard, not a security boundary —
// the real defence is bcrypt cost making brute-force impractical anyway.
// If we ever go multi-instance behind a load balancer we'd promote this
// to a small Postgres row keyed on device_id.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
interface RateLimitEntry {
  count: number;
  windowStart: number;
}
const attempts = new Map<string, RateLimitEntry>();

function rateLimitCheck(deviceId: string): {
  locked: boolean;
  resetInSec: number;
} {
  const now = Date.now();
  const entry = attempts.get(deviceId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    attempts.set(deviceId, { count: 1, windowStart: now });
    return { locked: false, resetInSec: 0 };
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    const resetInSec = Math.ceil(
      (RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)) / 1000,
    );
    return { locked: true, resetInSec };
  }
  return { locked: false, resetInSec: 0 };
}

function rateLimitClear(deviceId: string): void {
  attempts.delete(deviceId);
}

export type SubmitPinState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "locked"; resetInSec: number };

export async function submitPinAction(
  _prev: SubmitPinState,
  formData: FormData,
): Promise<SubmitPinState> {
  const cookieStore = await cookies();
  const deviceClaim = verifyDeviceCookie(
    cookieStore.get(KIOSK_DEVICE_COOKIE)?.value,
  );
  if (!deviceClaim) {
    return { status: "error", message: "Kiosk not paired." };
  }

  const pin = String(formData.get("pin") ?? "").trim();
  if (!/^\d{4}$/.test(pin)) {
    return { status: "error", message: "Enter your 4-digit PIN." };
  }

  // Rate-limit check BEFORE the bcrypt loop so a flood of bad guesses
  // doesn't even hit the database.
  const rl = rateLimitCheck(deviceClaim.deviceId);
  if (rl.locked) {
    return { status: "locked", resetInSec: rl.resetInSec };
  }

  // Bcrypt-compare against every PIN row in the tenant. O(N) per
  // submission — fine for a single workplace (38 GB users today).
  // For larger tenants we'd pre-filter to employees attached to this
  // device's location (sc_employees.location_id) — kept simple for v1.
  const candidates = await forTenant(deviceClaim.tenantId).run((tx) =>
    tx
      .select({
        appUserId: scEmployeePins.appUserId,
        pinHash: scEmployeePins.pinHash,
      })
      .from(scEmployeePins)
      .where(eq(scEmployeePins.traceyTenantId, deviceClaim.tenantId)),
  );

  let matched: { appUserId: string } | null = null;
  let matchCount = 0;
  for (const c of candidates) {
    if (await verifyPassword(pin, c.pinHash)) {
      matchCount += 1;
      matched = { appUserId: c.appUserId };
    }
  }

  if (matchCount === 0) {
    return { status: "error", message: "Wrong PIN. Try again." };
  }

  if (matchCount > 1) {
    // setPinAction's collision check should prevent this. If it slips
    // through (e.g. PINs set via direct DB write), refuse rather than
    // pick arbitrarily — and don't reveal the collision to the kiosk
    // user. Log server-side so an admin can fix it.
    console.warn(
      `[kiosk] PIN collision in tenant ${deviceClaim.tenantId} — refusing`,
    );
    return { status: "error", message: "Wrong PIN. Try again." };
  }

  // Success: clear the rate limit, mint a 60-sec actor cookie, redirect.
  rateLimitClear(deviceClaim.deviceId);
  cookieStore.set(
    KIOSK_ACTOR_COOKIE,
    signActorCookie(
      { appUserId: matched!.appUserId, deviceId: deviceClaim.deviceId },
      60,
    ),
    { ...KIOSK_COOKIE_OPTS, maxAge: 60 },
  );

  redirect("/kiosk/me");
}

// Exits the actor session early (e.g. user changed their mind before
// completing a punch). Clears the actor cookie and bounces back to the
// numpad; the device cookie is untouched.
export async function clearActorAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(KIOSK_ACTOR_COOKIE);
  redirect("/kiosk");
}
