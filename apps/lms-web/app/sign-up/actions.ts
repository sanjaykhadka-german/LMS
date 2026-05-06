"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, users, verificationTokens } from "@tracey/db";
import { hashPassword } from "~/lib/auth/passwords";
import { generateToken, tokenExpiry } from "~/lib/auth/tokens";
import { sendVerificationEmail } from "~/lib/auth/email";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200, "Password is too long"),
});

export type SignUpState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

export async function signUpAction(
  _prev: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const parsed = schema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { name, email, password } = parsed.data;

  const [existing] = await db
    .select({ id: users.id, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let userId: string;
  if (existing) {
    if (existing.emailVerified) {
      // Don't reveal whether the email is registered. Pretend we sent the
      // email — directs to the same waiting page.
      redirect(`/verify-email?email=${encodeURIComponent(email)}&sent=1`);
    }
    // Existing unverified row → update password + name, re-send verification.
    userId = existing.id;
    await db
      .update(users)
      .set({ name, passwordHash: await hashPassword(password), updatedAt: new Date() })
      .where(eq(users.id, userId));
  } else {
    const [created] = await db
      .insert(users)
      .values({ name, email, passwordHash: await hashPassword(password) })
      .returning({ id: users.id });
    if (!created) {
      return { status: "error", message: "Failed to create account. Please try again." };
    }
    userId = created.id;
  }

  const token = generateToken();
  await db.insert(verificationTokens).values({
    identifier: email,
    token,
    expires: tokenExpiry(24),
  });

  try {
    await sendVerificationEmail({ to: email, token, name });
  } catch (err) {
    console.error("[sign-up] failed to send verification email:", err);
    return {
      status: "error",
      message:
        "We couldn't send the verification email. Please try again or contact support.",
    };
  }

  redirect(`/verify-email?email=${encodeURIComponent(email)}&sent=1`);
}
