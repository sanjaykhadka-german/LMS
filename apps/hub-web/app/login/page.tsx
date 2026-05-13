// Placeholder login. Wire NextAuth here following the lms-web pattern:
//   - apps/hub-web/auth.config.ts + auth.ts (mirror apps/lms-web/auth.*)
//   - Credentials + OAuth providers per @tracey/auth
//   - On success, redirect to /dashboard
//
// Until then, the "Sign in" button just bounces to /dashboard for local dev.

import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <header>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← Back
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Sign in to Tracey</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          One account for Tracey LMS and ShiftCraft.
        </p>
      </header>

      <form className="mt-8 space-y-4" action="/dashboard">
        <div>
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Sign in
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Auth not wired yet — submit drops you on the dashboard. Hook up @tracey/auth
        to make this real.
      </p>
    </main>
  );
}
