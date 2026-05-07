import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, lmsUsers } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { WhsForm } from "../_form";
import { createWhsRecordAction } from "../actions";

export const metadata = { title: "New WHS record" };

export default async function NewWhsRecordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireAdmin();

  const staff = await db
    .select({ id: lmsUsers.id, name: lmsUsers.name })
    .from(lmsUsers)
    .where(eq(lmsUsers.traceyTenantId, ctx.traceyTenantId))
    .orderBy(asc(lmsUsers.name));

  const banner =
    sp.error === "date"
      ? "Date format wrong. Use YYYY-MM-DD."
      : sp.error === "invalid"
        ? "Some required fields are missing or invalid."
        : undefined;

  return (
    <div className="space-y-4">
      <Link href="/app/admin/whs" className="text-sm text-[color:var(--muted-foreground)] underline">
        ← Back to register
      </Link>
      <WhsForm action={createWhsRecordAction} staff={staff} errorBanner={banner} />
    </div>
  );
}
