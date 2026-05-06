import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { currentTenant } from "@tracey/auth";
import { siteConfig } from "~/lib/site-config";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const tenant = await currentTenant();
  if (!tenant) redirect("/onboarding");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 w-full border-b border-[color:var(--border)] bg-[color:var(--background)]/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link href="/app" className="flex items-center" aria-label={siteConfig.name}>
              <Image
                src="/tracey-logo.png"
                alt={siteConfig.name}
                width={1323}
                height={605}
                priority
                className="h-7 w-auto"
              />
            </Link>
            <OrganizationSwitcher
              afterCreateOrganizationUrl="/app"
              afterSelectOrganizationUrl="/app"
              hidePersonal
            />
          </div>
          <UserButton />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
