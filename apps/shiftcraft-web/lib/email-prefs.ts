import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { forTenant, scEmailUnsubscribes } from "@tracey/db";

// ─── Notification kinds ──────────────────────────────────────────────────
//
// Stable strings — they're persisted in sc_email_unsubscribes.kind, so
// renaming one is a data migration. Add new kinds at the bottom of the
// list (or extend the type) and the UI picks them up via the labels
// table below.

export const EMAIL_KINDS = [
  "announcements",
  "offers",
  "swaps",
] as const;

export type EmailKind = (typeof EMAIL_KINDS)[number];

export const EMAIL_KIND_LABELS: Record<EmailKind, { title: string; blurb: string }> = {
  announcements: {
    title: "Workspace announcements",
    blurb:
      "When a manager posts an announcement and chooses to email everyone.",
  },
  offers: {
    title: "Shift offers",
    blurb: "When a manager offers you a shift to accept or decline.",
  },
  swaps: {
    title: "Swap & cover requests",
    blurb:
      "When a teammate asks you to take or trade one of their shifts, and when your requests are answered.",
  },
};

// ─── Per-(tenant, user) checks ───────────────────────────────────────────
//
// Helpers return the *opt-out* set, mirroring how sc_email_unsubscribes
// stores rows only for users who unsubscribed. Callers AND in the
// negation: "send unless they're in this set".

/**
 * Fetch the user-ids that have opted OUT of a kind for a tenant. Used
 * by fan-out paths (announcement blast) to filter the recipient list
 * once before sending.
 */
export async function getUnsubscribedUserIds(
  tenantId: string,
  kind: EmailKind,
): Promise<Set<string>> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({ appUserId: scEmailUnsubscribes.appUserId })
      .from(scEmailUnsubscribes)
      .where(
        and(
          eq(scEmailUnsubscribes.traceyTenantId, tenantId),
          eq(scEmailUnsubscribes.kind, kind),
        ),
      ),
  );
  return new Set(rows.map((r) => r.appUserId));
}

/**
 * Check whether a single user has opted out. For 1:1 email paths
 * (offers, swaps) where loading the whole opt-out set is overkill.
 */
export async function isUnsubscribed(
  tenantId: string,
  appUserId: string,
  kind: EmailKind,
): Promise<boolean> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({ id: scEmailUnsubscribes.id })
      .from(scEmailUnsubscribes)
      .where(
        and(
          eq(scEmailUnsubscribes.traceyTenantId, tenantId),
          eq(scEmailUnsubscribes.appUserId, appUserId),
          eq(scEmailUnsubscribes.kind, kind),
        ),
      )
      .limit(1),
  );
  return rows.length > 0;
}

/**
 * Read the caller's full preferences map for the Settings UI. Returns
 * `enabled = true` for kinds with no opt-out row, `false` when a row
 * exists.
 */
export async function getEmailPrefsForUser(
  tenantId: string,
  appUserId: string,
): Promise<Record<EmailKind, boolean>> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({ kind: scEmailUnsubscribes.kind })
      .from(scEmailUnsubscribes)
      .where(
        and(
          eq(scEmailUnsubscribes.traceyTenantId, tenantId),
          eq(scEmailUnsubscribes.appUserId, appUserId),
          inArray(scEmailUnsubscribes.kind, EMAIL_KINDS as unknown as string[]),
        ),
      ),
  );
  const optedOut = new Set(rows.map((r) => r.kind as EmailKind));
  const out = {} as Record<EmailKind, boolean>;
  for (const k of EMAIL_KINDS) out[k] = !optedOut.has(k);
  return out;
}

/**
 * Set the preference for one kind. `enabled = true` deletes any
 * existing opt-out row; `enabled = false` inserts one (idempotent
 * via the unique index — onConflictDoNothing).
 */
export async function setEmailPref(
  tenantId: string,
  appUserId: string,
  kind: EmailKind,
  enabled: boolean,
): Promise<void> {
  if (enabled) {
    await forTenant(tenantId).run((tx) =>
      tx
        .delete(scEmailUnsubscribes)
        .where(
          and(
            eq(scEmailUnsubscribes.traceyTenantId, tenantId),
            eq(scEmailUnsubscribes.appUserId, appUserId),
            eq(scEmailUnsubscribes.kind, kind),
          ),
        ),
    );
  } else {
    await forTenant(tenantId).run((tx) =>
      tx
        .insert(scEmailUnsubscribes)
        .values({
          traceyTenantId: tenantId,
          appUserId,
          kind,
        })
        .onConflictDoNothing(),
    );
  }
}
