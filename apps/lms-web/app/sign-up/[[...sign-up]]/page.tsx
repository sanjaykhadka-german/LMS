import { SignUp } from "@clerk/nextjs";

export default function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  // The `?plan=` value is forwarded to /onboarding so we can pre-select a tier
  // there. We don't act on it here — Clerk handles the form, and we only
  // intercept after sign-up via `forceRedirectUrl`.
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <SearchParamsAwareSignUp searchParams={searchParams} />
    </div>
  );
}

async function SearchParamsAwareSignUp({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;
  const onboardingUrl = plan ? `/onboarding?plan=${encodeURIComponent(plan)}` : "/onboarding";
  return <SignUp signInUrl="/sign-in" forceRedirectUrl={onboardingUrl} />;
}
