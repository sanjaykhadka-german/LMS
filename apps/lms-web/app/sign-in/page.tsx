import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "~/../auth";
import { SignInForm } from "./_form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; returnTo?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/app");

  const { email, returnTo } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Welcome back to Tracey.
          </p>
        </div>
        <SignInForm prefilledEmail={email} returnTo={returnTo} />
        <p className="text-center text-sm text-[color:var(--muted-foreground)]">
          New here?{" "}
          <Link href="/sign-up" className="text-[color:var(--foreground)] underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
