import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, users } from "@tracey/db";
import {
  KIOSK_ACTOR_COOKIE,
  KIOSK_DEVICE_COOKIE,
  verifyActorCookie,
  verifyDeviceCookie,
} from "~/lib/kiosk/cookies";
import { clearActorAction } from "../actions";

export const metadata = { title: "Kiosk · Confirm" };
export const dynamic = "force-dynamic";

// Stub for Slice 5. Confirms the actor + device cookies resolve to a real
// user. Slice 6 replaces this with the full punch screen (today's shift,
// who's-here, announcement ack, selfie capture, in/out/break buttons).
export default async function KioskMePage() {
  const cookieStore = await cookies();
  const deviceClaim = verifyDeviceCookie(
    cookieStore.get(KIOSK_DEVICE_COOKIE)?.value,
  );
  const actorClaim = verifyActorCookie(
    cookieStore.get(KIOSK_ACTOR_COOKIE)?.value,
  );
  // Either cookie missing/expired → bounce to the numpad. Actor cookies
  // expire after 60 sec so a kiosk left at this page just goes home on
  // its own when the user refreshes.
  if (!deviceClaim || !actorClaim || actorClaim.deviceId !== deviceClaim.deviceId) {
    redirect("/kiosk");
  }

  const [user] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.id, actorClaim.appUserId)))
    .limit(1);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md space-y-5 rounded-xl border border-zinc-800 bg-zinc-900/80 p-8 text-center shadow-xl">
        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          PIN accepted
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hi {user?.name ?? user?.email ?? "there"}
        </h1>
        <p className="text-sm text-zinc-400">
          The clock-in / clock-out screen lands in the next update. For now
          this page just confirms your PIN and device pairing are wired
          end-to-end.
        </p>
        <form action={clearActorAction}>
          <button
            type="submit"
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
        </form>
      </div>
    </main>
  );
}
