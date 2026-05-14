import Link from "next/link";
import { redirect } from "next/navigation";
import { currentMembership } from "~/lib/auth/current";
import { EmployeeForm } from "./_form";

export const metadata = { title: "Add employee · ShiftCraft" };

export default async function NewEmployeePage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Add employee</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add someone to your ShiftCraft roster. Permanent and casual staff
            with an email will trigger a "suggest as learner" notification in
            the LMS so training can be assigned. Labour-hire rows stay
            ShiftCraft-only.
          </p>
        </div>
        <Link
          href="/app/employees"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to roster
        </Link>
      </div>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <EmployeeForm />
      </section>
    </div>
  );
}
