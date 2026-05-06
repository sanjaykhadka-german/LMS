import Link from "next/link";
import { Check } from "lucide-react";
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
import { cn } from "~/lib/utils";
import { pricingTiers } from "~/lib/site-config";

export function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-4 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Simple pricing, generous trial
        </h2>
        <p className="mt-3 text-[color:var(--muted-foreground)]">
          Start free for 14 days. Upgrade only when your team is on board.
        </p>
      </div>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {pricingTiers.map((tier) => (
          <Card
            key={tier.id}
            className={cn(
              "flex flex-col",
              tier.featured && "ring-2 ring-[color:var(--primary)]",
            )}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">{tier.name}</CardTitle>
                {tier.featured && <Badge>Most popular</Badge>}
              </div>
              <CardDescription className="pt-1">{tier.description}</CardDescription>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-semibold">{tier.priceLabel}</span>
                {tier.priceSubLabel && (
                  <span className="text-sm text-[color:var(--muted-foreground)]">
                    {tier.priceSubLabel}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex-1">
              <ul className="space-y-2 text-sm">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                asChild
                className="w-full"
                variant={tier.featured ? "default" : "outline"}
              >
                <Link href={tier.cta.href}>{tier.cta.label}</Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </section>
  );
}
