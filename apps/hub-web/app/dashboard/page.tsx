// Post-login app picker. Eventually this should:
//   1. requireUser() — bounce to /login if no session
//   2. fetch the user's accessible apps based on their tenant + role
//   3. render only the apps they have access to
//
// For the scaffold it just renders both apps unconditionally.

import Link from "next/link";
import { SWITCHABLE_APPS } from "~/lib/site-config";

export default function Dashboard() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-12">
      <header>
        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Tracey
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-2 text-muted-foreground">Pick an app to open.</p>
      </header>

      <section className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SWITCHABLE_APPS.map((app) => (
          <Link
            key={app.id}
            href={app.url}
            className="group rounded-lg border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
          >
            <h2 className="text-xl font-semibold">{app.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{app.tagline}</p>
            <p className="mt-4 text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
              Open →
            </p>
          </Link>
        ))}
      </section>

      <footer className="mt-auto pt-12 text-xs text-muted-foreground">
        <Link href="/account" className="hover:underline">
          Account &amp; billing
        </Link>
      </footer>
    </main>
  );
}
