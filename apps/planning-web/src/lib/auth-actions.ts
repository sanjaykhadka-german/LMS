"use server";

import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from "@/auth";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  // Clear the Supabase session cookie too, so legacy queries in feature
  // modules that still go through the Supabase client don't keep returning
  // data for the just-signed-out user. NextAuth signOut() handles the redirect.
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Best-effort; never block NextAuth signOut on Supabase cookie cleanup.
  }
  await nextAuthSignOut({ redirectTo: "/auth/login" });
}

export async function signIn(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  try {
    await nextAuthSignIn("credentials", {
      email,
      password,
      redirectTo: "/dashboard",
    });
    return {};
  } catch (err) {
    // next-auth throws a redirect error on success — let it propagate.
    if (err && typeof err === "object" && "digest" in err) throw err;
    return { error: "Wrong email or password." };
  }
}
