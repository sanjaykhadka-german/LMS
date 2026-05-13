"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, users } from "@tracey/db";
import { hashPassword } from "~/lib/auth/passwords";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200, "Password is too long"),
  returnTo: z.string().optional(),
});

export type SignUpState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

// Phase 1: skip the email-verification round-trip. Mark new accounts verified
// inline so users can sign in immediately. Wire Resend + /verify-email when
// the sign-up flow needs to gate on a real inbox check (mirror lms-web's
// app/sign-up/actions.ts at that point).
export async function signUpAction(
  _prev: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const parsed = schema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    returnTo: formData.get("returnTo") ?? undefined,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { name, email, password, returnTo } = parsed.data;
  const safeReturnTo = returnTo && returnTo.startsWith("/") ? returnTo : undefined;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    return {
      status: "error",
      message: "An account with that email already exists. Try signing in.",
    };
  }

  const passwordHash = await hashPassword(password);
  await db.insert(users).values({
    name,
    email,
    passwordHash,
    emailVerified: new Date(),
  });

  const params = new URLSearchParams({ email });
  if (safeReturnTo) params.set("returnTo", safeReturnTo);
  redirect(`/sign-in?${params.toString()}`);
}
