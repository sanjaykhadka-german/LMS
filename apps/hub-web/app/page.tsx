// Public marketing landing. Anyone (no auth) can see this.
// After login, users are bounced to /dashboard which is the real app picker.

import Link from "next/link";
import {
  ArrowRightLeft,
  CalendarDays,
  Check,
  Factory,
  GraduationCap,
  KeyRound,
  Receipt,
} from "lucide-react";
import { APPS } from "~/lib/site-config";

const lmsFeatures = [
  "Build training modules in minutes",
  "Assign by role or department",
  "Track WHS compliance",
  "Audit-ready reports",
];

const shiftcraftFeatures = [
  "Weekly roster builder",
  "Offer and swap shifts",
  "Time-off requests",
  "Live labour cost",
];

const planningFeatures = [
  "Live MRP cascade from demand",
  "Recipes, BOMs, and routings",
  "Cost breakdown per item",
  "Production scheduling and run sheets",
];

const valueProps = [
  {
    icon: KeyRound,
    title: "One login",
    body: "Staff sign in once, both apps work.",
  },
  {
    icon: Receipt,
    title: "One bill",
    body: "Single subscription, no per-product juggling.",
  },
  {
    icon: ArrowRightLeft,
    title: "Data flows between apps",
    body: "Add a new hire in ShiftCraft and their training assignments appear in the LMS automatically.",
  },
];

export default function MarketingHome() {
  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-4">
          <Link href="/" className="flex items-center" aria-label="Tracey">
            <span
              className="text-[2.7rem] leading-none tracking-tight"
              style={{ fontFamily: "var(--font-heading), ui-serif, Georgia, serif" }}
            >
              tr<span className="text-primary">a</span>cey
            </span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              href="/login?signup=1"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Start free trial
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-20 pb-12">
        <h1 className="max-w-4xl text-4xl font-semibold tracking-tight md:text-5xl">
          Staff training, scheduling, planning, sales, and manufacturing — one platform.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          Tracey unifies staff training, shift scheduling, production planning, sales,
          and manufacturing — built for operations teams in food and hospitality.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-5">
          <Link
            href="/login?signup=1"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Start free trial
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Sign in →
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <article className="flex flex-col rounded-lg border bg-card p-8 shadow-sm">
            <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-md bg-sky-50 text-sky-700">
              <GraduationCap className="h-5 w-5" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">{APPS.lms.name}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Staff training and compliance
            </p>
            <ul className="mt-6 space-y-3">
              {lmsFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Link
                href={APPS.lms.url}
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Open Tracey LMS
              </Link>
            </div>
          </article>

          <article className="flex flex-col rounded-lg border bg-card p-8 shadow-sm">
            <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-md bg-violet-50 text-violet-700">
              <CalendarDays className="h-5 w-5" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {APPS.shiftcraft.name}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Employee shift scheduling
            </p>
            <ul className="mt-6 space-y-3">
              {shiftcraftFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Link
                href={APPS.shiftcraft.url}
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Open ShiftCraft
              </Link>
            </div>
          </article>

          <article className="flex flex-col rounded-lg border bg-card p-8 shadow-sm">
            <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
              <Factory className="h-5 w-5" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {APPS.planning.name}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Production planning and MRP
            </p>
            <ul className="mt-6 space-y-3">
              {planningFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Link
                href={APPS.planning.url}
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Open Tracey Planning
              </Link>
            </div>
          </article>
        </div>
      </section>

      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight">
            Why one platform
          </h2>
          <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
            {valueProps.map(({ icon: Icon, title, body }) => (
              <div key={title}>
                <Icon className="h-5 w-5 text-foreground" />
                <h3 className="mt-3 text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-col items-start gap-3 px-6 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Tracey</span>
          <nav className="flex items-center gap-4">
            <Link href="/login" className="hover:text-foreground">
              Sign in
            </Link>
            <Link href={`${APPS.lms.url}/#pricing`} className="hover:text-foreground">
              Pricing
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
