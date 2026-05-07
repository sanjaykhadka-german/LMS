import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, lmsUsers, lmsWhsRecords } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { WhsForm } from "../../_form";
import { updateWhsRecordAction } from "../../actions";

export const metadata = { title: "Edit WHS record" };

export default async function EditWhsRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const recordId = parseInt(id, 10);
  if (!Number.isFinite(recordId)) notFound();
  const sp = await searchParams;

  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const [record] = await db
    .select()
    .from(lmsWhsRecords)
    .where(and(eq(lmsWhsRecords.id, recordId), tenantWhere(lmsWhsRecords, tid)))
    .limit(1);
  if (!record) notFound();

  const staff = await db
    .select({ id: lmsUsers.id, name: lmsUsers.name })
    .from(lmsUsers)
    .where(eq(lmsUsers.traceyTenantId, tid))
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
      <WhsForm
        action={updateWhsRecordAction}
        staff={staff}
        errorBanner={banner}
        record={{
          id: record.id,
          kind: record.kind,
          title: record.title,
          userId: record.userId,
          issuedOn: record.issuedOn,
          expiresOn: record.expiresOn,
          notes: record.notes ?? "",
          incidentDate: record.incidentDate,
          severity: record.severity,
          reportedById: record.reportedById,
        }}
      />
    </div>
  );
}
