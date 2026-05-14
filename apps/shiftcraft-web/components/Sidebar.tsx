"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertCircle,
  BarChart3,
  CalendarCheck,
  CalendarDays,
  CalendarOff,
  ClipboardList,
  Clock,
  History,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  MapPin,
  Megaphone,
  Repeat,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { friendlyRoleLabel } from "~/lib/roles";
import { Logo } from "./Logo";
import { signOutAction } from "~/app/app/_actions";

const NAV = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/clock", label: "Time clock", icon: Clock },
  { href: "/app/my-shifts", label: "My shifts", icon: CalendarCheck },
  { href: "/app/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/app/coverage-gaps", label: "Coverage gaps", icon: AlertCircle },
  { href: "/app/timesheets", label: "Timesheets", icon: ClipboardList },
  { href: "/app/tasks", label: "Tasks", icon: KanbanSquare },
  { href: "/app/locations", label: "Locations", icon: MapPin },
  { href: "/app/employees", label: "Employees", icon: Users },
  { href: "/app/team", label: "Team", icon: Shield },
  { href: "/app/time-off", label: "Time off", icon: CalendarOff },
  { href: "/app/announcements", label: "Announcements", icon: Megaphone },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

const ADMIN_NAV = [
  { href: "/app/reports", label: "Reports", icon: BarChart3 },
  { href: "/app/swaps", label: "Swap requests", icon: Repeat },
  { href: "/app/audit", label: "Audit log", icon: History },
];

export function Sidebar({ name, role }: { name: string; role: string }) {
  const pathname = usePathname();
  const isAdmin = role === "admin" || role === "owner";
  const items = isAdmin ? [...NAV, ...ADMIN_NAV] : NAV;
  return (
    <aside className="sticky top-0 flex h-screen w-64 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-5 py-6">
        <Logo size="sm" />
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={2} />
              <span className="flex-1">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border px-3 py-4">
        <div className="mb-2 px-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Signed in as
          </div>
          <div className="truncate text-sm font-medium">{name}</div>
          <div className="text-[11px] text-muted-foreground">
            {friendlyRoleLabel(role)}
          </div>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
