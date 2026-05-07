import Link from "next/link";
import {
  Building2,
  Cog,
  GraduationCap,
  Network,
  Users,
} from "lucide-react";
import { requireAdmin } from "~/lib/auth/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Gate every page under /app/admin. Provisioning is also done here once
  // per request, so child pages can call requireAdmin() again without a
  // double bcrypt round-trip (getOrProvisionLmsUser short-circuits when the
  // row already exists).
  await requireAdmin();

  return (
    <div className="mx-auto flex max-w-6xl gap-8 px-4 py-8">
      <aside className="hidden w-56 shrink-0 md:block">
        <nav className="space-y-1 text-sm">
          <SidebarLink href="/app/admin" icon={GraduationCap}>
            Overview
          </SidebarLink>
          <SidebarLink href="/app/admin/employees" icon={Users}>
            Employees
          </SidebarLink>
          <SidebarLink href="/app/admin/departments" icon={Building2}>
            Departments
          </SidebarLink>
          <SidebarLink href="/app/admin/employers" icon={Building2}>
            Employers
          </SidebarLink>
          <SidebarLink href="/app/admin/positions" icon={Network}>
            Positions
          </SidebarLink>
          <SidebarLink href="/app/admin/machines" icon={Cog}>
            Machines
          </SidebarLink>
        </nav>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

function SidebarLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: typeof Users;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)]"
    >
      <Icon className="h-4 w-4" aria-hidden />
      {children}
    </Link>
  );
}
