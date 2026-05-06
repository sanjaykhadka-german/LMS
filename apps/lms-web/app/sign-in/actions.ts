"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { signIn } from "~/../auth";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password").max(200),
  returnTo: z.string().optional(),
});

export type SignInState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = schema.safeParse({
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
  const { email, password, returnTo } = parsed.data;

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: returnTo && returnTo.startsWith("/") ? returnTo : "/app",
    });
    return { status: "idle" }; // unreachable — signIn redirects on success
  } catch (err) {
    if (err instanceof AuthError) {
      const cause = err.cause?.err?.message;
      if (cause === "EmailNotVerified") {
        return {
          status: "error",
          message:
            "Please verify your email before signing in. Check your inbox for the verification link.",
        };
      }
      if (err.type === "CredentialsSignin") {
        return { status: "error", message: "Wrong email or password." };
      }
      return { status: "error", message: "Sign in failed. Please try again." };
    }
    // next/navigation redirects throw a special error that must propagate.
    throw err;
  }
}
