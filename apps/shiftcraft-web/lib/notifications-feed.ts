import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, notifications } from "@tracey/db";

// Read + write helpers around `app.notifications` for the calling user
// in a specific tenant. The table itself is shared (lives in the `app`
// schema, not per-tenant) — tenant scoping is via the `tenantId`
// column. See packages/db/src/schema.ts comment for the rationale.

export interface FeedNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  actionUrl: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export async function getUnreadCount(
  tenantId: string,
  recipientUserId: string,
): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, tenantId),
        eq(notifications.recipientUserId, recipientUserId),
        isNull(notifications.readAt),
      ),
    );
  return row?.c ?? 0;
}

/**
 * Most recent notifications for the user in this tenant. Read + unread
 * mixed; the page groups them visually. Capped at `limit` to keep
 * payloads small.
 */
export async function getRecentNotifications(
  tenantId: string,
  recipientUserId: string,
  limit = 50,
): Promise<FeedNotification[]> {
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      actionUrl: notifications.actionUrl,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, tenantId),
        eq(notifications.recipientUserId, recipientUserId),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows;
}

/**
 * Mark a list of notifications as read. The (tenant, recipient) filter
 * is what stops cross-tenant or other-user writes — RLS isn't enforced
 * on app.notifications.
 */
export async function markNotificationsRead(
  tenantId: string,
  recipientUserId: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.tenantId, tenantId),
        eq(notifications.recipientUserId, recipientUserId),
        inArray(notifications.id, ids),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return result.length;
}

/**
 * Mark every unread notification for (tenant, user) as read. Cheap
 * single-statement UPDATE — no count returned by drizzle without a
 * .returning(), so we compute one for the caller.
 */
export async function markAllNotificationsRead(
  tenantId: string,
  recipientUserId: string,
): Promise<number> {
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.tenantId, tenantId),
        eq(notifications.recipientUserId, recipientUserId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return result.length;
}
