import Link from "next/link";
import { Button } from "~/components/ui/button";
import { siteConfig } from "~/lib/site-config";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[color:var(--background)] via-[color:var(--background)] to-[color:var(--accent)]/5"
      />
      <div className="relative mx-auto max-w-6xl px-4 py-20 sm:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="text-center lg:text-left">
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
              {siteConfig.tagline}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-[color:var(--muted-foreground)] lg:mx-0">
              Tracey turns your policies, procedures, and training materials into quizzes,
              qualifications, and audit trails. Built for teams who want their
              people trained — not their LMS managed.
            </p>
            <div className="mt-10 flex items-center justify-center gap-3 lg:justify-start">
              <Button asChild size="lg">
                <Link href="/sign-up">Start {siteConfig.trialDays}-day free trial</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="#pricing">See pricing</Link>
              </Button>
            </div>
            <p className="mt-4 text-xs text-[color:var(--muted-foreground)]">
              No credit card required.
            </p>
          </div>
          <div className="mx-auto w-full max-w-md lg:max-w-none">
            <BrowserMockup />
          </div>
        </div>
      </div>
    </section>
  );
}

function BrowserMockup() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -inset-6 rounded-3xl bg-gradient-to-br from-[color:var(--primary)]/25 via-[color:var(--accent)]/15 to-transparent blur-3xl"
      />
      <div className="relative overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[color:var(--border)] bg-[color:var(--muted)] px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-red-400/80" />
          <span className="h-3 w-3 rounded-full bg-amber-400/80" />
          <span className="h-3 w-3 rounded-full bg-emerald-400/80" />
          <div className="ml-3 flex-1 rounded-md bg-[color:var(--background)] px-3 py-1 text-xs text-[color:var(--muted-foreground)]">
            tracey.app/app
          </div>
        </div>
        <div className="space-y-4 p-6">
          <div className="h-6 w-40 rounded bg-gradient-to-r from-[color:var(--primary)] to-[color:var(--accent)]/70" />
          <div className="grid grid-cols-3 gap-3">
            <div className="h-16 rounded-md bg-[color:var(--muted)]" />
            <div className="h-16 rounded-md bg-[color:var(--muted)]" />
            <div className="h-16 rounded-md bg-[color:var(--muted)]" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-[color:var(--muted)]" />
            <div className="h-3 w-5/6 rounded bg-[color:var(--muted)]" />
            <div className="h-3 w-4/6 rounded bg-[color:var(--muted)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
