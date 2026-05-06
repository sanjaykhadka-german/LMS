"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, tenants, members, type Tenant } from "@tracey/db";
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

  let created: Tenant | undefined;
  // Slug is unique-indexed (tenants_slug_uq). Two people from the same
  // company often type variants of the same workspace name; we silently
  // suffix on collision rather than rejecting their submission. After 3
  // attempts something is genuinely wrong, so surface the error.
  const baseSlug = slugify(name);
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${randomBytes(2).toString("hex")}`;
    try {
      [created] = await db
        .insert(tenants)
        .values({ ownerUserId: user.id, name, slug })
        .returning();
      break;
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 2) continue;
      throw err;
    }
  }
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
  return base || `workspace-${randomBytes(3).toString("hex")}`;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}
