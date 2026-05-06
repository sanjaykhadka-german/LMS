import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { CreateOrganization } from "@clerk/nextjs";

export default async function OnboardingPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");
  if (orgId) redirect("/app");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
        <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
          One workspace per company. You can invite teammates and switch between
          workspaces later.
        </p>
      </div>
      <CreateOrganization afterCreateOrganizationUrl="/app" skipInvitationScreen={false} />
    </div>
  );
}
