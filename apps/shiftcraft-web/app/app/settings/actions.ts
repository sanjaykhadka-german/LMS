"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, users as appUsers } from "@tracey/db";
import { currentUser } from "~/lib/auth/current";
import { hashPassword, verifyPassword } from "~/lib/auth/passwords";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Too long"),
});

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    next: z
      .string()
      .min(8, "Use at least 8 characters")
      .max(200, "Too long"),
    confirm: z.string(),
  })
  .refine((d) => d.next === d.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

export async function updateProfileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const me = await currentUser();
  if (!me) return { status: "error", message: "Not signed in." };

  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  await db
    .update(appUsers)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(eq(appUsers.id, me.id));

  revalidatePath("/app/settings");
  return { status: "ok", message: "Profile updated." };
}

export async function changePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const me = await currentUser();
  if (!me) return { status: "error", message: "Not signed in." };

  const parsed = passwordSchema.safeParse({
    current: formData.get("current") ?? "",
    next: formData.get("next") ?? "",
    confirm: formData.get("confirm") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const [row] = await db
    .select({ passwordHash: appUsers.passwordHash })
    .from(appUsers)
    .where(eq(appUsers.id, me.id))
    .limit(1);
  if (!row?.passwordHash) {
    // SSO-only accounts can't change their password here.
    return {
      status: "error",
      message:
        "This account doesn't have a password set. Password changes aren't available for SSO accounts.",
    };
  }
  const ok = await verifyPassword(parsed.data.current, row.passwordHash);
  if (!ok) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { current: ["Current password is incorrect."] },
    };
  }
  if (parsed.data.next === parsed.data.current) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: {
        next: ["New password must differ from the current one."],
      },
    };
  }

  const newHash = await hashPassword(parsed.data.next);
  // Bump passwordChangedAt so any JWTs minted before now get rejected at
  // the next requireUser() call (see app.users.passwordChangedAt comment
  // in packages/db/src/schema.ts).
  await db
    .update(appUsers)
    .set({
      passwordHash: newHash,
      passwordChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(appUsers.id, me.id));

  return { status: "ok", message: "Password changed." };
}
