import "server-only";

import { and, eq } from "drizzle-orm";
import { forTenant, plTenantLabels } from "@tracey/db";
import { CANONICAL_LABELS, isCanonicalKey } from "./canonical-keys";

export interface LabelRow {
  canonical_key: string;
  display_label: string;
  default_label: string;
  is_overridden: boolean;
  description: string | null;
  example_locations: string | null;
  sort_order: number;
}

// TS port of get_tenant_labels(): merge the seeded canonical key list with the
// tenant's per-key overrides. Ordered by sort_order then key.
export async function getTenantLabels(tenantId: string): Promise<LabelRow[]> {
  const overrides = await forTenant(tenantId).run((tx) =>
    tx
      .select({ labelKey: plTenantLabels.labelKey, labelValue: plTenantLabels.labelValue })
      .from(plTenantLabels)
      .where(eq(plTenantLabels.traceyTenantId, tenantId)),
  );
  const byKey = new Map(overrides.map((r) => [r.labelKey, r.labelValue]));

  const rows: LabelRow[] = CANONICAL_LABELS.map((c) => {
    const override = byKey.get(c.canonical_key);
    return {
      canonical_key: c.canonical_key,
      display_label: override ?? c.default_label,
      default_label: c.default_label,
      is_overridden: override !== undefined,
      description: c.description,
      example_locations: c.example_locations,
      sort_order: c.sort_order,
    };
  });
  rows.sort((a, b) => a.sort_order - b.sort_order || a.canonical_key.localeCompare(b.canonical_key));
  return rows;
}

// TS port of set_tenant_label(): upsert one override. Caller must verify the
// user is admin-or-above before calling — server actions enforce that.
export async function setTenantLabel(
  tenantId: string,
  canonicalKey: string,
  displayLabel: string,
): Promise<void> {
  if (!isCanonicalKey(canonicalKey)) {
    throw new Error(`unknown canonical key: ${canonicalKey}`);
  }
  const trimmed = displayLabel.trim();
  if (!trimmed) throw new Error("display label cannot be empty");

  await forTenant(tenantId).run((tx) =>
    tx
      .insert(plTenantLabels)
      .values({
        traceyTenantId: tenantId,
        labelKey: canonicalKey,
        labelValue: trimmed,
      })
      .onConflictDoUpdate({
        target: [plTenantLabels.traceyTenantId, plTenantLabels.labelKey],
        set: { labelValue: trimmed, updatedAt: new Date() },
      }),
  );
}

// TS port of reset_tenant_label(): delete the override so the default takes over.
export async function resetTenantLabel(tenantId: string, canonicalKey: string): Promise<void> {
  if (!isCanonicalKey(canonicalKey)) {
    throw new Error(`unknown canonical key: ${canonicalKey}`);
  }
  await forTenant(tenantId).run((tx) =>
    tx
      .delete(plTenantLabels)
      .where(
        and(
          eq(plTenantLabels.traceyTenantId, tenantId),
          eq(plTenantLabels.labelKey, canonicalKey),
        ),
      ),
  );
}
