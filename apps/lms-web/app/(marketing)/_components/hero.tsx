import Link from "next/link";
import { Button } from "~/components/ui/button";
import { siteConfig } from "~/lib/site-config";

export function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:py-32">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
          {siteConfig.tagline}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-[color:var(--muted-foreground)]">
          Tracey turns your SOPs, SQF documents, and machine training into quizzes,
          qualifications, and audit trails. Built for operations teams who want their
          people trained — not their LMS managed.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/sign-up">Start 14-day free trial</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="#pricing">See pricing</Link>
          </Button>
        </div>
        <p className="mt-4 text-xs text-[color:var(--muted-foreground)]">
          No credit card required.
        </p>
      </div>
    </section>
  );
}
