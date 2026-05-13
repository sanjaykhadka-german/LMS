"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  scShiftAssignments,
  scShifts,
  scShiftSwapRequests,
} from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";

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

  // Verify the initiator owns the assignment, it's currently accepted, and
  // the underlying shift hasn't started yet.
  const ok = await assertOwnedFutureAccepted(
    membership.tenant.id,
    parsed.data.assignmentId,
    user.id,
  );
  if (!ok)
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

  const mineOk = await assertOwnedFutureAccepted(
    membership.tenant.id,
    parsed.data.assignmentId,
    user.id,
  );
  if (!mineOk)
    return { status: "error", message: "Your shift can no longer be swapped." };

  const theirsOk = await assertOwnedFutureAccepted(
    membership.tenant.id,
    parsed.data.targetAssignmentId,
    parsed.data.targetUserId,
  );
  if (!theirsOk)
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

  revalidatePath("/app/my-shifts");
  return { status: "ok", message: "Swap proposal sent." };
}

export async function acceptSwapAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const membership = await requireMembership();
  const user = await requireUser();
  const now = new Date();

  await forTenant(membership.tenant.id).run(async (tx) => {
    // Load the swap row inside the same transaction; SELECT FOR UPDATE
    // would be ideal but the unique partial index already serialises
    // accept/cancel races at insert time, and the WHERE status='pending'
    // guards below make the mutating UPDATEs no-op on the loser.
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

    // 1. Flip initiator's existing assignment to 'swapped'.
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

    // 2. Insert (or upgrade) target's new assignment on initiator's shift.
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

    // 3. If it's a two-way swap, mirror the same dance for target's shift.
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
      const targetShiftId = targetFlipped.shiftId;

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

    // 4. Close the swap request.
    await tx
      .update(scShiftSwapRequests)
      .set({ status: "accepted", decidedAt: now })
      .where(
        and(
          eq(scShiftSwapRequests.id, id),
          eq(scShiftSwapRequests.status, "pending"),
        ),
      );
  });

  revalidatePath("/app/my-shifts");
  revalidatePath("/app/schedule");
  revalidatePath("/app/swaps");
}

export async function declineSwapAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const membership = await requireMembership();
  const user = await requireUser();
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scShiftSwapRequests)
      .set({ status: "declined", decidedAt: new Date() })
      .where(
        and(
          eq(scShiftSwapRequests.id, id),
          eq(scShiftSwapRequests.targetUserId, user.id),
          eq(scShiftSwapRequests.status, "pending"),
        ),
      ),
  );
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

async function assertOwnedFutureAccepted(
  tenantId: string,
  assignmentId: string,
  expectedUserId: string,
): Promise<boolean> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({ id: scShiftAssignments.id })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
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
  return rows.length > 0;
}
