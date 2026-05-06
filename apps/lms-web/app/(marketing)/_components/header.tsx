import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { Button } from "~/components/ui/button";
import { siteConfig } from "~/lib/site-config";

export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-[color:var(--border)] bg-[color:var(--background)]/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="text-base">{siteConfig.name}</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            href="#features"
            className="hidden text-sm text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] sm:inline"
          >
            Features
          </Link>
          <Link
            href="#pricing"
            className="hidden text-sm text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] sm:inline"
          >
            Pricing
          </Link>
          <Link
            href="#faq"
            className="hidden text-sm text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] sm:inline"
          >
            FAQ
          </Link>
          <SignedOut>
            <Button asChild variant="ghost" size="sm">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/sign-up">Get started</Link>
            </Button>
          </SignedOut>
          <SignedIn>
            <Button asChild size="sm">
              <Link href="/app">Open app</Link>
            </Button>
          </SignedIn>
        </nav>
      </div>
    </header>
  );
}
