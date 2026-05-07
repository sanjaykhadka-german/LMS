import Link from "next/link";
import {
  Building2,
  ClipboardList,
  Cog,
  FileText,
  GraduationCap,
  Grid3x3,
  HardHat,
  Network,
  Users,
  Library,
  Receipt,
  Sparkles,
} from "lucide-react";
import { requireAdmin } from "~/lib/auth/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <div className="mx-auto flex max-w-6xl gap-8 px-4 py-8">
      <aside className="hidden w-56 shrink-0 md:block">
        <nav className="text-sm">
          <SidebarSection label="Training">
            <SidebarLink href="/app/admin" icon={GraduationCap}>
              Overview
            </SidebarLink>
            <SidebarLink href="/app/admin/modules" icon={Library}>
              Modules
            </SidebarLink>
            <SidebarLink href="/app/admin/modules/ai-studio" icon={Sparkles}>
              AI Studio
            </SidebarLink>
            <SidebarLink href="/app/admin/assignments" icon={ClipboardList}>
              Assignments
            </SidebarLink>
            <SidebarLink href="/app/admin/training-matrix" icon={Grid3x3}>
              Training matrix
            </SidebarLink>
            <SidebarLink href="/app/admin/whs" icon={HardHat}>
              WHS register
            </SidebarLink>
            <SidebarLink href="/app/admin/register" icon={Receipt}>
              Staff register
            </SidebarLink>
          </SidebarSection>
          <SidebarSection label="Settings">
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
            <SidebarLink href="/app/admin/audit-logs" icon={FileText}>
              Audit logs
            </SidebarLink>
          </SidebarSection>
        </nav>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

function SidebarSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
        {label}
      </div>
      <div className="space-y-1">{children}</div>
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
