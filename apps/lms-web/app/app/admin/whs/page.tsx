import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, lmsUsers, lmsWhsRecords } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { DeleteRowForm } from "../_components/DeleteRowForm";
import { deleteWhsRecordAction } from "./actions";

export const metadata = { title: "WHS register" };

const KIND_LABELS: Record<string, string> = {
  high_risk_licence: "High-risk licence",
  fire_warden: "Fire warden",
  first_aider: "First aider",
  incident: "Incident",
};

const SEVERITY_VARIANT: Record<string, "secondary" | "warning" | "destructive"> = {
  low: "secondary",
  medium: "warning",
  high: "destructive",
  critical: "destructive",
};

export default async function WhsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const baseFilter = sp.kind && KIND_LABELS[sp.kind]
    ? eq(lmsWhsRecords.kind, sp.kind)
    : undefined;

  const records = await db
    .select({
      id: lmsWhsRecords.id,
      kind: lmsWhsRecords.kind,
      title: lmsWhsRecords.title,
      issuedOn: lmsWhsRecords.issuedOn,
      expiresOn: lmsWhsRecords.expiresOn,
      severity: lmsWhsRecords.severity,
      incidentDate: lmsWhsRecords.incidentDate,
      userName: lmsUsers.name,
    })
    .from(lmsWhsRecords)
    .leftJoin(lmsUsers, eq(lmsUsers.id, lmsWhsRecords.userId))
    .where(
      baseFilter ? and(baseFilter, tenantWhere(lmsWhsRecords, tid)) : tenantWhere(lmsWhsRecords, tid),
    )
    .orderBy(desc(lmsWhsRecords.expiresOn), asc(lmsWhsRecords.title));

  const today = new Date();
  const soonMs = 30 * 24 * 60 * 60 * 1000;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">WHS register</h1>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            High-risk licences, fire wardens, first aiders, and incident reports.
          </p>
        </div>
        <Button asChild>
          <Link href="/app/admin/whs/new">Add record</Link>
        </Button>
      </div>

      {sp.ok && (
        <div className="rounded-md border border-emerald-500 bg-emerald-50/50 px-4 py-2 text-sm dark:bg-emerald-900/10">
          Record {sp.ok}.
        </div>
      )}

      <nav className="flex flex-wrap gap-2 text-xs">
        <KindLink current={sp.kind} kind={null} label="All" />
        {Object.entries(KIND_LABELS).map(([k, label]) => (
          <KindLink key={k} current={sp.kind} kind={k} label={label} />
        ))}
      </nav>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Records ({records.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
                <tr>
                  <th className="px-6 py-2">Title</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Person</th>
                  <th className="px-3 py-2">Expires</th>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-6 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-6 text-center text-[color:var(--muted-foreground)]">
                      No WHS records yet.
                    </td>
                  </tr>
                ) : (
                  records.map((r) => {
                    const exp = r.expiresOn ? new Date(r.expiresOn) : null;
                    const expSoon = exp && exp.getTime() < today.getTime() + soonMs;
                    const expired = exp && exp.getTime() < today.getTime();
                    return (
                      <tr key={r.id}>
                        <td className="px-6 py-3 align-middle">
                          <Link href={`/app/admin/whs/${r.id}/edit`} className="font-medium hover:underline">
                            {r.title}
                          </Link>
                        </td>
                        <td className="px-3 py-3 align-middle">{KIND_LABELS[r.kind] ?? r.kind}</td>
                        <td className="px-3 py-3 align-middle">{r.userName ?? "—"}</td>
                        <td className="px-3 py-3 align-middle">
                          {r.expiresOn ?? (r.kind === "incident" ? "—" : "")}
                          {expired && <Badge className="ml-2" variant="destructive">Expired</Badge>}
                          {!expired && expSoon && <Badge className="ml-2" variant="warning">Soon</Badge>}
                        </td>
                        <td className="px-3 py-3 align-middle">
                          {r.severity ? (
                            <Badge variant={SEVERITY_VARIANT[r.severity] ?? "secondary"}>
                              {r.severity}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-6 py-3 align-middle text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button asChild variant="outline" size="sm">
                              <Link href={`/app/admin/whs/${r.id}/edit`}>Edit</Link>
                            </Button>
                            <DeleteRowForm
                              action={deleteWhsRecordAction}
                              id={r.id}
                              confirmMessage={`Delete '${r.title}'?`}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KindLink({
  current,
  kind,
  label,
}: {
  current: string | undefined;
  kind: string | null;
  label: string;
}) {
  const active = (kind === null && !current) || current === kind;
  const href = kind ? `/app/admin/whs?kind=${kind}` : "/app/admin/whs";
  return (
    <Link
      href={href}
      className={`rounded-md border px-3 py-1.5 ${
        active
          ? "border-[color:var(--foreground)] bg-[color:var(--foreground)] text-[color:var(--background)]"
          : "border-[color:var(--border)] hover:bg-[color:var(--secondary)]"
      }`}
    >
      {label}
    </Link>
  );
}

