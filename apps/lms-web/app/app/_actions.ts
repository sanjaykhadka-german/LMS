"use server";

import { redirect } from "next/navigation";
import { signOut } from "~/../auth";
import { setActiveTenant } from "~/lib/auth/current";

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

export async function switchTenantAction(formData: FormData) {
  const tenantId = formData.get("tenantId");
  if (typeof tenantId !== "string" || !tenantId) {
    redirect("/app");
  }
  await setActiveTenant(tenantId as string);
  redirect("/app");
}
