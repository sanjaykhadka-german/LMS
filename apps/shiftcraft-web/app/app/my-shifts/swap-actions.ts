"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  forTenant,
  scLocations,
  scShiftAssignments,
  scShifts,
  scShiftSwapRequests,
  users,
} from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";
import {
  notifySwapAccepted,
  notifySwapDeclined,
  notifySwapRequested,
} from "~/lib/email";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

async function requireMembership() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace.");
  return m;
}

const coverSchema = z.object({
  assignmentId: z.string().uuid("Pick a shift"),
  targetUserId: z.string().uuid("Pick a teammate"),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

const swapSchema = coverSchema.extend({
  targetAssignmentId: z.string().uuid("Pick a shift to receive"),
});

interface ShiftDetail {
  startsAt: Date;
  endsAt: Date;
  role: string;
  locationName: string | null;
}

export async function initiateCoverAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = coverSchema.safeParse({
    assignmentId: formData.get("assignmentId"),
    targetUserId: formData.get("targetUserId"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const membership = await requireMembership();
  const user = await requireUser();
  if (parsed.data.targetUserId === user.id) {
    return { status: "error", message: "You can't ask yourself to cover." };
  }

  const initiatorShift = await loadOwnedFutureAccepted(
    membership.tenant.id,
    parsed.data.assignmentId,
    user.id,
  );
  if (!initiatorShift)
    return {
      status: "error",
      message: "That shift can no longer be handed off.",
    };

  try {
    await forTenant(membership.tenant.id).run((tx) =>
      tx.insert(scShiftSwapRequests).values({
        traceyTenantId: membership.tenant.id,
        initiatorUserId: user.id,
        initiatorAssignmentId: parsed.data.assignmentId,
        targetUserId: parsed.data.targetUserId,
        targetAssignmentId: null,
        note: parsed.data.note?.length ? parsed.data.note : null,
      }),
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("sc_swap_pending_unique")) {
      return {
        status: "error",
        message: "There's already a pending request for this shift.",
      };
    }
    throw err;
  }

  // Email after the DB transaction has committed. Recipient lookups go via
  // the bare `db` client because app.users isn't on the tenant search_path.
  const [target, initiator] = await Promise.all([
    lookupUser(parsed.data.targetUserId),
    lookupUser(user.id),
  ]);
  if (target) {
    await notifySwapRequested({
      to: target,
      from: initiator ?? { name: null, email: user.email },
      giveaway: initiatorShift,
      receive: null,
      note: parsed.data.note?.length ? parsed.data.note : null,
    });
  }

  revalidatePath("/app/my-shifts");
  return { status: "ok", message: "Cover request sent." };
}

export async function initiateSwapAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = swapSchema.safeParse({
    assignmentId: formData.get("assignmentId"),
    targetUserId: formData.get("targetUserId"),
    targetAssignmentId: formData.get("targetAssignmentId"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const membership = await requireMembership();
  const user = await requireUser();
  if (parsed.data.targetUserId === user.id) {
    return { status: "error", message: "You can't swap with yourself." };
  }
  if (parsed.data.assignmentId === parsed.data.targetAssignmentId) {
    return { status: "error", message: "Pick a different shift to receive." };
  }

  const initiatorShift = await loadOwnedFutureAccepted(
    membership.tenant.id,
    parsed.data.assignmentId,
    user.id,
  );
  if (!initiatorShift)
    return { status: "error", message: "Your shift can no longer be swapped." };

  const targetShift = await loadOwnedFutureAccepted(
    membership.tenant.id,
    parsed.data.targetAssignmentId,
    parsed.data.targetUserId,
  );
  if (!targetShift)
    return {
      status: "error",
      message: "Their shift is no longer eligible for a swap.",
    };

  try {
    await forTenant(membership.tenant.id).run((tx) =>
      tx.insert(scShiftSwapRequests).values({
        traceyTenantId: membership.tenant.id,
        initiatorUserId: user.id,
        initiatorAssignmentId: parsed.data.assignmentId,
        targetUserId: parsed.data.targetUserId,
        targetAssignmentId: parsed.data.targetAssignmentId,
        note: parsed.data.note?.length ? parsed.data.note : null,
      }),
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("sc_swap_pending_unique")) {
      return {
        status: "error",
        message: "There's already a pending request for this shift.",
      };
    }
    throw err;
  }

  const [target, initiator] = await Promise.all([
    lookupUser(parsed.data.targetUserId),
    lookupUser(user.id),
  ]);
  if (target) {
    await notifySwapRequested({
      to: target,
      from: initiator ?? { name: null, email: user.email },
      giveaway: initiatorShift,
      receive: targetShift,
      note: parsed.data.note?.length ? parsed.data.note : null,
    });
  }

  revalidatePath("/app/my-shifts");
  return { status: "ok", message: "Swap proposal sent." };
}

export async function acceptSwapAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const membership = await requireMembership();
  const user = await requireUser();
  const now = new Date();

  type CommittedSwap = {
    initiatorUserId: string;
    isSwap: boolean;
    initiatorShiftId: string;
    targetShiftId: string | null;
  };

  const result = await forTenant(membership.tenant.id).run<CommittedSwap | null>(
    async (tx) => {
      const [swap] = await tx
        .select()
        .from(scShiftSwapRequests)
        .where(
          and(
            eq(scShiftSwapRequests.id, id),
            eq(scShiftSwapRequests.targetUserId, user.id),
            eq(scShiftSwapRequests.status, "pending"),
          ),
        )
        .limit(1);
      if (!swap) throw new Error("This swap can no longer be accepted.");

      const flipInitiator = await tx
        .update(scShiftAssignments)
        .set({ status: "swapped", respondedAt: now })
        .where(
          and(
            eq(scShiftAssignments.id, swap.initiatorAssignmentId),
            eq(scShiftAssignments.userId, swap.initiatorUserId),
            eq(scShiftAssignments.status, "accepted"),
          ),
        )
        .returning({ shiftId: scShiftAssignments.shiftId });
      const [initiatorFlipped] = flipInitiator;
      if (!initiatorFlipped)
        throw new Error("Initiator's shift status changed; swap aborted.");
      const initiatorShiftId = initiatorFlipped.shiftId;

      await tx
        .insert(scShiftAssignments)
        .values({
          shiftId: initiatorShiftId,
          userId: user.id,
          status: "accepted",
          respondedAt: now,
        })
        .onConflictDoUpdate({
          target: [scShiftAssignments.shiftId, scShiftAssignments.userId],
          set: { status: "accepted", respondedAt: now },
        });

      let targetShiftId: string | null = null;
      if (swap.targetAssignmentId) {
        const flipTarget = await tx
          .update(scShiftAssignments)
          .set({ status: "swapped", respondedAt: now })
          .where(
            and(
              eq(scShiftAssignments.id, swap.targetAssignmentId),
              eq(scShiftAssignments.userId, user.id),
              eq(scShiftAssignments.status, "accepted"),
            ),
          )
          .returning({ shiftId: scShiftAssignments.shiftId });
        const [targetFlipped] = flipTarget;
        if (!targetFlipped)
          throw new Error("Your shift status changed; swap aborted.");
        targetShiftId = targetFlipped.shiftId;

        await tx
          .insert(scShiftAssignments)
          .values({
            shiftId: targetShiftId,
            userId: swap.initiatorUserId,
            status: "accepted",
            respondedAt: now,
          })
          .onConflictDoUpdate({
            target: [scShiftAssignments.shiftId, scShiftAssignments.userId],
            set: { status: "accepted", respondedAt: now },
          });
      }

      await tx
        .update(scShiftSwapRequests)
        .set({ status: "accepted", decidedAt: now })
        .where(
          and(
            eq(scShiftSwapRequests.id, id),
            eq(scShiftSwapRequests.status, "pending"),
          ),
        );

      return {
        initiatorUserId: swap.initiatorUserId,
        isSwap: !!swap.targetAssignmentId,
        initiatorShiftId,
        targetShiftId,
      };
    },
  );

  if (result) {
    const [initiator, acceptor, gaveAway, pickedUp] = await Promise.all([
      lookupUser(result.initiatorUserId),
      lookupUser(user.id),
      loadShiftById(membership.tenant.id, result.initiatorShiftId),
      result.targetShiftId
        ? loadShiftById(membership.tenant.id, result.targetShiftId)
        : Promise.resolve(null),
    ]);
    if (initiator && gaveAway) {
      await notifySwapAccepted({
        to: initiator,
        acceptor: acceptor ?? { name: null, email: user.email },
        gaveAway,
        pickedUp: result.isSwap ? pickedUp : null,
      });
    }
  }

  revalidatePath("/app/my-shifts");
  revalidatePath("/app/schedule");
  revalidatePath("/app/swaps");
}

export async function declineSwapAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const membership = await requireMembership();
  const user = await requireUser();

  const [updated] = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scShiftSwapRequests)
      .set({ status: "declined", decidedAt: new Date() })
      .where(
        and(
          eq(scShiftSwapRequests.id, id),
          eq(scShiftSwapRequests.targetUserId, user.id),
          eq(scShiftSwapRequests.status, "pending"),
        ),
      )
      .returning({
        initiatorUserId: scShiftSwapRequests.initiatorUserId,
        initiatorAssignmentId: scShiftSwapRequests.initiatorAssignmentId,
      }),
  );

  if (updated) {
    const [initiator, decliner, giveaway] = await Promise.all([
      lookupUser(updated.initiatorUserId),
      lookupUser(user.id),
      loadShiftByAssignment(membership.tenant.id, updated.initiatorAssignmentId),
    ]);
    if (initiator && giveaway) {
      await notifySwapDeclined({
        to: initiator,
        decliner: decliner ?? { name: null, email: user.email },
        giveaway,
      });
    }
  }

  revalidatePath("/app/my-shifts");
  revalidatePath("/app/swaps");
}

export async function cancelSwapAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const membership = await requireMembership();
  const user = await requireUser();
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scShiftSwapRequests)
      .set({ status: "cancelled", decidedAt: new Date() })
      .where(
        and(
          eq(scShiftSwapRequests.id, id),
          eq(scShiftSwapRequests.initiatorUserId, user.id),
          eq(scShiftSwapRequests.status, "pending"),
        ),
      ),
  );
  revalidatePath("/app/my-shifts");
  revalidatePath("/app/swaps");
}

async function loadOwnedFutureAccepted(
  tenantId: string,
  assignmentId: string,
  expectedUserId: string,
): Promise<ShiftDetail | null> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        role: scShifts.role,
        locationName: scLocations.name,
      })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(
        and(
          eq(scShiftAssignments.id, assignmentId),
          eq(scShiftAssignments.userId, expectedUserId),
          eq(scShiftAssignments.status, "accepted"),
          gt(scShifts.startsAt, new Date()),
        ),
      )
      .limit(1),
  );
  return rows[0] ?? null;
}

async function loadShiftById(
  tenantId: string,
  shiftId: string,
): Promise<ShiftDetail | null> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        role: scShifts.role,
        locationName: scLocations.name,
      })
      .from(scShifts)
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(eq(scShifts.id, shiftId))
      .limit(1),
  );
  return rows[0] ?? null;
}

async function loadShiftByAssignment(
  tenantId: string,
  assignmentId: string,
): Promise<ShiftDetail | null> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        role: scShifts.role,
        locationName: scLocations.name,
      })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(eq(scShiftAssignments.id, assignmentId))
      .limit(1),
  );
  return rows[0] ?? null;
}

async function lookupUser(
  userId: string,
): Promise<{ email: string; name: string | null } | null> {
  const [row] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}
