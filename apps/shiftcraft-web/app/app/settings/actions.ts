"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, users as appUsers } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { validateAvatarUrl } from "~/lib/avatar";
import {
  EMAIL_KINDS,
  setEmailPref,
  type EmailKind,
} from "~/lib/email-prefs";
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

/**
 * Toggle one email-notification preference for the calling user in the
 * current tenant. Bound directly to a <form>, so the return type stays
 * void — the page revalidates and reads the new state on the next
 * render.
 */
export async function toggleEmailPrefAction(
  formData: FormData,
): Promise<void> {
  const me = await currentUser();
  if (!me) return;
  const membership = await currentMembership();
  if (!membership) return;

  const kindRaw = String(formData.get("kind") ?? "");
  const enabledRaw = String(formData.get("enabled") ?? "");
  if (!(EMAIL_KINDS as readonly string[]).includes(kindRaw)) return;
  const kind = kindRaw as EmailKind;
  const enabled = enabledRaw === "true";

  await setEmailPref(membership.tenant.id, me.id, kind, enabled);
  revalidatePath("/app/settings");
}

/**
 * Update or clear the caller's avatar URL. Stored on app.users.image
 * (shared identity column). Validation lives in lib/avatar.ts —
 * http/https only, length-capped, no data: / javascript: schemes.
 */
export async function updateAvatarAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const me = await currentUser();
  if (!me) return { status: "error", message: "Not signed in." };

  let image: string | null;
  try {
    image = validateAvatarUrl(String(formData.get("avatarUrl") ?? ""));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid URL.";
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { avatarUrl: [message] },
    };
  }

  await db
    .update(appUsers)
    .set({ image, updatedAt: new Date() })
    .where(eq(appUsers.id, me.id));

  // The avatar shows up in the sidebar of every authenticated page, so
  // revalidate the whole /app layout — otherwise the user has to navigate
  // before the swatch updates.
  revalidatePath("/app", "layout");
  return {
    status: "ok",
    message: image ? "Avatar updated." : "Avatar cleared — using initials.",
  };
}
