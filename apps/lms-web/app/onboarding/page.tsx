import { redirect } from "next/navigation";
import { requireUser, currentMembership } from "~/lib/auth/current";
import { OnboardingForm } from "./_form";

export default async function OnboardingPage() {
  await requireUser();
  // If they already have a membership, /app is the right place.
  const existing = await currentMembership();
  if (existing) redirect("/app");

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Create your workspace
          </h1>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            One workspace per company. You'll be able to invite teammates once it's
            set up.
          </p>
        </div>
        <OnboardingForm />
      </div>
    </div>
  );
}
