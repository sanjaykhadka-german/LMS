import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "~/../auth";
import { SignUpForm } from "./_form";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/app");

  const { plan } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Start your 24-day free trial. No credit card required.
          </p>
        </div>
        <SignUpForm plan={plan} />
        <p className="text-center text-sm text-[color:var(--muted-foreground)]">
          Already have an account?{" "}
          <Link href="/sign-in" className="text-[color:var(--foreground)] underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
