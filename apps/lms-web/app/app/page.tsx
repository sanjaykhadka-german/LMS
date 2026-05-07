import Link from "next/link";
import { currentTenant } from "~/lib/auth/current";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { pricingTiers } from "~/lib/site-config";

const statusVariant = {
  trialing: "warning",
  active: "success",
  past_due: "destructive",
  canceled: "secondary",
} as const;

const statusLabel = {
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
} as const;

function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  const ms = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export default async function DashboardPage() {
  const tenant = await currentTenant();
  if (!tenant) return null; // layout already redirected

  const trialDaysLeft =
    tenant.status === "trialing" ? daysUntil(tenant.trialEndsAt) : null;
  const planName =
    pricingTiers.find((t) => t.id === tenant.plan)?.name ??
    tenant.plan.charAt(0).toUpperCase() + tenant.plan.slice(1);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tenant.name}</h1>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Welcome back.
          </p>
        </div>
        <Badge variant={statusVariant[tenant.status as keyof typeof statusVariant]}>
          {statusLabel[tenant.status as keyof typeof statusLabel]}
          {trialDaysLeft !== null && ` — ${trialDaysLeft}d left`}
        </Badge>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Plan</CardTitle>
            <CardDescription>
              You are on the <strong>{planName}</strong> plan.
              {tenant.currentPeriodEnd && (
                <> Renews {tenant.currentPeriodEnd.toISOString().slice(0, 10)}.</>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tenant.stripeCustomerId ? (
              <BillingPortalButton />
            ) : (
              <SubscribeButtons />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Training</CardTitle>
            <CardDescription>
              See your assigned modules, take quizzes, and review past results.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild className="w-full">
              <Link href="/app/my/modules">My training</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

function BillingPortalButton() {
  return (
    <form action="/api/billing/portal" method="post">
      <Button type="submit" className="w-full">
        Manage billing
      </Button>
    </form>
  );
}

function SubscribeButtons() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[color:var(--muted-foreground)]">
        Pick a paid plan to continue after your trial.
      </p>
      <div className="flex flex-wrap gap-2">
        {pricingTiers
          .filter((t) => t.cta.kind === "signup")
          .map((tier) => (
            <form key={tier.id} action="/api/billing/checkout" method="post">
              <input type="hidden" name="plan" value={tier.id} />
              <input type="hidden" name="billing" value="monthly" />
              <Button
                type="submit"
                variant={tier.featured ? "default" : "outline"}
                size="sm"
              >
                Subscribe — {tier.name}
              </Button>
            </form>
          ))}
        <Button asChild variant="ghost" size="sm">
          <Link href="/#pricing">Compare plans</Link>
        </Button>
      </div>
      <p className="text-xs text-[color:var(--muted-foreground)]">
        Annual billing (save 20%) available from Manage billing after upgrade.
      </p>
    </div>
  );
}
