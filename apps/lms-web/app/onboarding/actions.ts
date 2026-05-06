"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db, tenants, members } from "@tracey/db";
import { requireUser, setActiveTenant } from "~/lib/auth/current";

const schema = z.object({
  name: z.string().trim().min(1, "Workspace name is required").max(100),
});

export type CreateTenantState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

export async function createTenantAction(
  _prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  const user = await requireUser();
  const parsed = schema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { name } = parsed.data;
  const slug = slugify(name);

  const [created] = await db
    .insert(tenants)
    .values({ ownerUserId: user.id, name, slug })
    .returning();
  if (!created) {
    return { status: "error", message: "Failed to create workspace. Please try again." };
  }

  await db.insert(members).values({
    tenantId: created.id,
    userId: user.id,
    role: "owner",
  });

  await setActiveTenant(created.id);
  redirect("/app");
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || `workspace-${Math.random().toString(36).slice(2, 8)}`;
}
