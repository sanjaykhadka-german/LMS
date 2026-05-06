import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import {
  currentMembership,
  currentUser,
  listUserTenants,
} from "~/lib/auth/current";
import { siteConfig } from "~/lib/site-config";
import { UserMenu } from "./_components/user-menu";
import { TenantSwitcher } from "./_components/tenant-switcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in?returnTo=/app");

  const membership = await currentMembership();
  if (!membership) redirect("/onboarding");

  const tenants = await listUserTenants();
  const switcherOptions = tenants.map((m) => ({
    id: m.tenant.id,
    name: m.tenant.name,
    role: m.role,
  }));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 w-full border-b border-[color:var(--border)] bg-[color:var(--background)]/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link href="/app" className="flex items-center" aria-label={siteConfig.name}>
              <Image
                src="/tracey-wordmark.png"
                alt={siteConfig.name}
                width={1323}
                height={605}
                priority
                className="h-9 w-auto"
              />
            </Link>
            <TenantSwitcher
              active={{
                id: membership.tenant.id,
                name: membership.tenant.name,
                role: membership.role,
              }}
              options={switcherOptions}
            />
          </div>
          <UserMenu name={user.name} email={user.email} />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
