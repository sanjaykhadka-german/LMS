"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/auth/current";
import { resetTenantLabel, setTenantLabel } from "@/lib/labels/server";

function assertAdmin(role: string): void {
  if (role !== "owner" && role !== "admin") {
    throw new Error("only admins can edit tenant vocabulary");
  }
}

export async function setLabelAction(canonicalKey: string, displayLabel: string): Promise<void> {
  const { tenant, role } = await requireTenant();
  assertAdmin(role);
  await setTenantLabel(tenant.id, canonicalKey, displayLabel);
  revalidatePath("/settings/vocabulary");
}

export async function resetLabelAction(canonicalKey: string): Promise<void> {
  const { tenant, role } = await requireTenant();
  assertAdmin(role);
  await resetTenantLabel(tenant.id, canonicalKey);
  revalidatePath("/settings/vocabulary");
}
