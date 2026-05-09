import "server-only";
import { db, notifications } from "@tracey/db";

/**
 * Insert one in-app notification. Best-effort: a failure here must not block
 * the user-visible action that triggered the notification (assignments,
 * reminders, etc.). Logs and resolves on error.
 */
export async function createNotification(input: {
  tenantId: string;
  recipientUserId: string;
  kind: string;
  title: string;
  body?: string | null;
  actionUrl?: string | null;
}): Promise<void> {
  try {
    await db.insert(notifications).values({
      tenantId: input.tenantId,
      recipientUserId: input.recipientUserId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      actionUrl: input.actionUrl ?? null,
    });
  } catch (err) {
    console.error("[notifications] failed to insert:", input.kind, err);
  }
}

export async function createNotifications(
  inputs: Array<Parameters<typeof createNotification>[0]>,
): Promise<void> {
  if (inputs.length === 0) return;
  try {
    await db.insert(notifications).values(
      inputs.map((i) => ({
        tenantId: i.tenantId,
        recipientUserId: i.recipientUserId,
        kind: i.kind,
        title: i.title,
        body: i.body ?? null,
        actionUrl: i.actionUrl ?? null,
      })),
    );
  } catch (err) {
    console.error("[notifications] bulk insert failed:", inputs.length, err);
  }
}
