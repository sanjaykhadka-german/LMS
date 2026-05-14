"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scLocations } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

const locationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Too long"),
  timezone: z.string().trim().min(1, "Timezone is required").max(64),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  color: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .regex(/^#[0-9a-f]{6}$/i, "Use a #RRGGBB hex value like #7C1F1F"),
    ])
    .optional(),
});

function emptyToNull(v: string | undefined | null): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function requireTenant() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace to manage locations.");
  return m.tenant;
}

export async function createLocationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = locationSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone"),
    address: formData.get("address") ?? "",
    color: formData.get("color") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const tenant = await requireTenant();
  await forTenant(tenant.id).run((tx) =>
    tx.insert(scLocations).values({
      name: parsed.data.name,
      timezone: parsed.data.timezone,
      address: emptyToNull(parsed.data.address),
      color: emptyToNull(parsed.data.color)?.toLowerCase() ?? null,
      traceyTenantId: tenant.id,
    }),
  );
  revalidatePath("/app/locations");
  return { status: "ok", message: `Added ${parsed.data.name}.` };
}

export async function updateLocationAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = locationSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone"),
    address: formData.get("address") ?? "",
    color: formData.get("color") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const tenant = await requireTenant();
  await forTenant(tenant.id).run((tx) =>
    tx
      .update(scLocations)
      .set({
        name: parsed.data.name,
        timezone: parsed.data.timezone,
        address: emptyToNull(parsed.data.address),
        color: emptyToNull(parsed.data.color)?.toLowerCase() ?? null,
      })
      .where(and(eq(scLocations.id, id), eq(scLocations.traceyTenantId, tenant.id))),
  );
  revalidatePath("/app/locations");
  revalidatePath(`/app/locations/${id}/edit`);
  return { status: "ok", message: "Saved." };
}

export async function deleteLocationAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const tenant = await requireTenant();
  await forTenant(tenant.id).run((tx) =>
    tx
      .delete(scLocations)
      .where(and(eq(scLocations.id, id), eq(scLocations.traceyTenantId, tenant.id))),
  );
  revalidatePath("/app/locations");
  redirect("/app/locations");
}
