import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import {
  db,
  auditEvents,
  invitations,
  members,
  tenants,
  users,
} from "@tracey/db";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

const statusVariant = {
  trialing: "warning",
  active: "success",
  past_due: "destructive",
  canceled: "secondary",
} as const;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PlatformTenantDetailPage({ params }: PageProps) {
  const { id } = await params;

  const [tenant] = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      plan: tenants.plan,
      status: tenants.status,
      trialEndsAt: tenants.trialEndsAt,
      currentPeriodEnd: tenants.currentPeriodEnd,
      seatsPurchased: tenants.seatsPurchased,
      stripeCustomerId: tenants.stripeCustomerId,
      stripeSubscriptionId: tenants.stripeSubscriptionId,
      createdAt: tenants.createdAt,
      ownerEmail: users.email,
    })
    .from(tenants)
    .leftJoin(users, eq(users.id, tenants.ownerUserId))
    .where(eq(tenants.id, id))
    .limit(1);
  if (!tenant) notFound();

  const memberRows = await db
    .select({
      id: members.id,
      role: members.role,
      createdAt: members.createdAt,
      email: users.email,
      name: users.name,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.tenantId, id))
    .orderBy(desc(members.createdAt));

  const pendingRows = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(eq(invitations.tenantId, id))
    .orderBy(desc(invitations.createdAt));

  const auditRows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      actorEmail: auditEvents.actorEmail,
      targetKind: auditEvents.targetKind,
      targetId: auditEvents.targetId,
      details: auditEvents.details,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(eq(auditEvents.tenantId, id))
    .orderBy(desc(auditEvents.createdAt))
    .limit(50);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
          {tenant.slug}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{tenant.name}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Overview</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Row label="Owner" value={tenant.ownerEmail ?? "—"} />
          <Row label="Plan" value={tenant.plan} />
          <Row
            label="Status"
            value={
              <Badge
                variant={statusVariant[tenant.status as keyof typeof statusVariant] ?? "secondary"}
              >
                {tenant.status}
              </Badge>
            }
          />
          <Row label="Members" value={String(memberRows.length)} />
          <Row label="Seats" value={String(tenant.seatsPurchased)} />
          <Row label="Created" value={tenant.createdAt.toISOString().slice(0, 10)} />
          <Row
            label="Trial ends"
            value={tenant.trialEndsAt.toISOString().slice(0, 10)}
          />
          <Row
            label="Renews"
            value={tenant.currentPeriodEnd?.toISOString().slice(0, 10) ?? "—"}
          />
          <Row label="Stripe customer" value={tenant.stripeCustomerId ?? "—"} mono />
          <Row label="Stripe subscription" value={tenant.stripeSubscriptionId ?? "—"} mono />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Members ({memberRows.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-[color:var(--border)]">
          {memberRows.map((m) => (
            <div key={m.id} className="flex items-center justify-between py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{m.name ?? m.email}</div>
                <div className="text-xs text-[color:var(--muted-foreground)] truncate">{m.email}</div>
              </div>
              <Badge variant={m.role === "owner" ? "default" : "secondary"}>{m.role}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {pendingRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pending invitations ({pendingRows.length})</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-[color:var(--border)]">
            {pendingRows.map((inv) => {
              const expired = inv.expiresAt.getTime() < Date.now();
              return (
                <div key={inv.id} className="flex items-center justify-between py-2.5 gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{inv.email}</div>
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      {expired
                        ? "Expired"
                        : `Expires ${inv.expiresAt.toISOString().slice(0, 10)}`}
                    </div>
                  </div>
                  <Badge variant="outline">{inv.role}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Audit ({auditRows.length})</CardTitle>
          <CardDescription>Last 50 events; newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {auditRows.length === 0 ? (
            <p className="py-3 text-sm text-[color:var(--muted-foreground)]">No events yet.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {auditRows.map((e) => (
                <li key={e.id} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <code className="text-xs font-medium">{e.action}</code>
                    <span className="text-xs text-[color:var(--muted-foreground)]">
                      {e.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    {e.actorEmail ?? "system"}
                    {e.targetKind && (
                      <>
                        {" · "}
                        {e.targetKind}
                        {e.targetId && <code className="ml-1">{e.targetId.slice(0, 8)}</code>}
                      </>
                    )}
                  </div>
                  {e.details ? (
                    <pre className="mt-1 overflow-x-auto rounded bg-[color:var(--secondary)] px-2 py-1 text-[11px]">
                      {JSON.stringify(e.details, null, 2)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[color:var(--muted-foreground)]">{label}</span>
      <span className={mono ? "font-mono text-xs" : "font-medium"}>{value}</span>
    </div>
  );
}
