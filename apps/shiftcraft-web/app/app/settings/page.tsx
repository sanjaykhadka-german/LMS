import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, users as appUsers } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { PasswordForm } from "./_password-form";
import { ProfileForm } from "./_profile-form";

export const metadata = { title: "Settings · ShiftCraft" };

export default async function SettingsPage() {
  const me = await currentUser();
  if (!me) redirect("/sign-in");
  const membership = await currentMembership();

  // Re-read the row so we always reflect the latest persisted state (the
  // session JWT may still hold the old name after a profile edit until the
  // user signs out and back in).
  const [row] = await db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      name: appUsers.name,
      passwordHash: appUsers.passwordHash,
      passwordChangedAt: appUsers.passwordChangedAt,
    })
    .from(appUsers)
    .where(eq(appUsers.id, me.id))
    .limit(1);
  if (!row) redirect("/sign-in");

  const hasPassword = !!row.passwordHash;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage how you appear and how you sign in.
          {membership && (
            <>
              {" "}
              Active workspace:{" "}
              <span className="font-medium">{membership.tenant.name}</span>.
            </>
          )}
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">Profile</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          Your name appears on shifts, timesheets, tasks, and the roster.
        </p>
        <ProfileForm defaultName={row.name ?? ""} />
        <p className="mt-4 text-xs text-muted-foreground">
          Email: <span className="font-mono">{row.email}</span> — changing
          this would change your sign-in identity. Contact a workspace owner
          if you need to move accounts.
        </p>
      </section>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">Password</h2>
        {hasPassword ? (
          <>
            <p className="mt-1 mb-4 text-xs text-muted-foreground">
              Last changed{" "}
              {row.passwordChangedAt.toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
              . Changing it signs you out of any other sessions.
            </p>
            <PasswordForm />
          </>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            This account doesn't have a password — you sign in via SSO.
            Password changes aren't available here.
          </p>
        )}
      </section>
    </div>
  );
}
