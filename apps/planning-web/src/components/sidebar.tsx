"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState, useEffect } from "react";
import { signOut } from "@/lib/auth-actions";
import type { UserRole } from "@/lib/types";
import { PLANNER_ROLES } from "@/lib/types";

// ── Icons ──────────────────────────────────────────────────────────────────
const Icon = {
  dashboard:  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  customers:  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  orders:     <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>,
  dispatch:   <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  invoices:   <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  plans:      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  dept:       <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  goodsIn:    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>,
  items:      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  bom:        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  inventory:  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
  lots:       <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  specs:      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  pallet:     <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="13" width="22" height="8" rx="1"/><path d="M4 13V7"/><path d="M12 13V7"/><path d="M20 13V7"/><path d="M2 7h20"/></svg>,
  reports:    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  suppliers:  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  allergens:  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  machines:   <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M5.34 18.66l-1.41 1.41M19.07 19.07l-1.41-1.41M5.34 5.34L3.93 3.93M22 12h-2M4 12H2M12 22v-2M12 4V2"/></svg>,
  users:      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  audit:      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  settings:   <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M5.34 18.66l-1.41 1.41M19.07 19.07l-1.41-1.41M5.34 5.34L3.93 3.93M22 12h-2M4 12H2M12 22v-2M12 4V2"/></svg>,
  money:      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  barcode:    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5v14M8 5v14M13 5v14M18 5v14M21 5v14"/></svg>,
  stocktake:  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  purchaseOrder: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>,
};

function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg suppressHydrationWarning width="11" height="11" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transition: "transform 0.18s", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", flexShrink: 0 }}
    >
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}

type SidebarDept = { id: string; name: string; code: string | null; sort_order: number };

interface SidebarProps {
  userEmail: string;
  userRole: UserRole;
  tenantName: string;
  departments: SidebarDept[];
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const STORAGE_KEY     = "tracey_sidebar_collapsed";
const NAV_RAIL_KEY    = "tracey_sidebar_rail";
const RAIL_WIDTH      = 56;
const DEFAULT_WIDTH   = 260;

export default function Sidebar({ userEmail, userRole, tenantName, departments }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // rail = icon-only collapsed mode
  const [rail, setRail] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Close sidebar on route change (mobile)
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Restore persisted section-collapse state
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setCollapsed(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  // Restore persisted rail state + sync CSS var
  useEffect(() => {
    try {
      const stored = localStorage.getItem(NAV_RAIL_KEY);
      const isRail = stored === "1";
      setRail(isRail);
      document.documentElement.style.setProperty("--sidebar-width", `${isRail ? RAIL_WIDTH : DEFAULT_WIDTH}px`);
    } catch { /* ignore */ }
  }, []);

  // Sync CSS variable whenever rail changes
  useEffect(() => {
    if (!mounted) return;
    document.documentElement.style.setProperty("--sidebar-width", `${rail ? RAIL_WIDTH : DEFAULT_WIDTH}px`);
    try { localStorage.setItem(NAV_RAIL_KEY, rail ? "1" : "0"); } catch { /* ignore */ }
  }, [rail, mounted]);

  function toggleSection(section: string) {
    setCollapsed(prev => {
      const next = { ...prev, [section]: !prev[section] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    if (href === "/orders") return pathname === "/orders" || (pathname.startsWith("/orders/") && !pathname.startsWith("/orders/floor"));
    return pathname.startsWith(href);
  }

  function canSee(roles: UserRole[] | null) {
    if (!roles) return true;
    return roles.includes(userRole);
  }

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (rail) return; // don't resize in rail mode
    e.preventDefault();
    const root = document.documentElement;
    const startX = e.clientX;
    const startW = parseInt(getComputedStyle(root).getPropertyValue("--sidebar-width")) || DEFAULT_WIDTH;
    const onMove = (ev: MouseEvent) => {
      const newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + (ev.clientX - startX)));
      root.style.setProperty("--sidebar-width", `${newW}px`);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [rail]);

  // padding values — explicit so shorthand never conflicts with paddingLeft
  const PAD = { top: "0.5rem", right: "0.875rem", bottom: "0.5rem", inactive: "0.875rem", active: "calc(0.875rem - 3px)" };

  type NavItem = {
    label: string;
    href: string;
    icon: React.ReactNode;
    roles?: UserRole[] | null;
  };

  type NavSection = {
    section: string;
    roles: UserRole[] | null;
    items: NavItem[];
  };

  // ── Navigation — ordered by business flow ─────────────────────────────────
  const NAV: NavSection[] = [
    {
      section: "Home",
      roles: null,
      items: [
        { label: "Dashboard", href: "/dashboard", icon: Icon.dashboard },
      ],
    },
    {
      section: "Sales",
      roles: PLANNER_ROLES,
      items: [
        { label: "Customers",      href: "/customers",    icon: Icon.customers },
        { label: "Orders",         href: "/orders",       icon: Icon.orders },
        { label: "Dispatch Floor", href: "/orders/floor", icon: Icon.dispatch },
        { label: "Invoices",       href: "/invoices",     icon: Icon.invoices },
      ],
    },
    {
      section: "Planning",
      roles: PLANNER_ROLES,
      items: [
        { label: "Demand Plans", href: "/plans", icon: Icon.plans },
      ],
    },
    {
      section: "Production",
      roles: null,
      items: departments.map(d => ({
        label: d.name,
        href: `/dept/${d.name.toLowerCase().replace(/\s+/g, "-")}`,
        icon: Icon.dept,
      })),
    },
    {
      section: "Inventory",
      roles: [...PLANNER_ROLES, "production", "filling"] as UserRole[],
      items: [
        { label: "Goods In",          href: "/goods-in",         icon: Icon.goodsIn },
        { label: "Stocktakes",        href: "/stocktakes",       icon: Icon.stocktake },
        { label: "Purchase Orders",   href: "/purchase-orders",  icon: Icon.purchaseOrder },
        { label: "Purchasing",        href: "/purchasing",       icon: Icon.purchaseOrder },
        { label: "MRP Overrides",     href: "/overrides",        icon: Icon.purchaseOrder },
        { label: "Item Master",       href: "/items",            icon: Icon.items },
        { label: "Bills of Materials",href: "/bom",              icon: Icon.bom },
        { label: "Product Specs",     href: "/specs",            icon: Icon.specs },
        { label: "Stock Levels",      href: "/inventory",        icon: Icon.inventory },
        { label: "Lot Numbers",       href: "/lots",             icon: Icon.lots },
      ],
    },
    {
      section: "Reports",
      roles: PLANNER_ROLES,
      items: [
        { label: "Reports & Export", href: "/reports", icon: Icon.reports },
        { label: "Costings",         href: "/costings", icon: Icon.money },
      ],
    },
    {
      section: "Settings",
      roles: ["super_admin", "admin", "manager"] as UserRole[],
      items: [
        { label: "Suppliers",           href: "/settings/suppliers",       icon: Icon.suppliers },
        { label: "Allergens",           href: "/settings/allergens",       icon: Icon.allergens },
        { label: "Ingredient Classes",  href: "/settings/ingredient-classifications", icon: Icon.allergens },
        { label: "Departments",         href: "/settings/departments",     icon: Icon.dept },
        { label: "Rooms",               href: "/settings/rooms",           icon: Icon.dept },
        { label: "Locations",           href: "/settings/locations",       icon: Icon.dept },
        { label: "Units of Measure",    href: "/settings/units-of-measure",icon: Icon.dept },
        { label: "Machines",            href: "/settings/machines",        icon: Icon.machines },
        { label: "Item Types",          href: "/settings/item-types",      icon: Icon.items },
        { label: "Item Categories",     href: "/settings/item-categories", icon: Icon.items },
        { label: "Tax Codes",           href: "/settings/tax-codes",       icon: Icon.money },
        { label: "Price Groups",        href: "/settings/price-groups",    icon: Icon.money },
        { label: "Barcodes",            href: "/settings/barcodes",        icon: Icon.barcode },
        { label: "Pallet Configs",      href: "/settings/pallet-configs",  icon: Icon.pallet },
        { label: "Roles & Permissions", href: "/settings/roles",           icon: Icon.users,    roles: ["super_admin", "admin"] as UserRole[] },
        { label: "Users",               href: "/settings/users",           icon: Icon.users,    roles: ["super_admin", "admin", "manager"] as UserRole[] },
        { label: "Audit Log",           href: "/settings/audit",           icon: Icon.audit,    roles: ["super_admin", "admin"] as UserRole[] },
        { label: "Business Settings",   href: "/settings/tenant",          icon: Icon.settings, roles: ["super_admin", "admin"] as UserRole[] },
        { label: "Vocabulary",          href: "/settings/vocabulary",      icon: Icon.settings, roles: ["super_admin", "admin"] as UserRole[] },
      ],
    },
  ];

  // ── Defer rendering until mounted ────────────────────────────────────────
  // Hydration runs against the server-rendered HTML. Browser extensions and
  // any localStorage-driven state can cause mismatches if we render real
  // content on the server. Render a blank shell with the same width on the
  // server + first client render; after hydration, swap in the full nav.
  if (!mounted) {
    return (
      <nav
        className="sidebar"
        suppressHydrationWarning
        aria-hidden="true"
        style={{ overflow: "hidden" }}
      />
    );
  }

  // ── Rail mode (icon-only) ─────────────────────────────────────────────────
  if (rail) {
    return (
      <>
        <div className={`sidebar-overlay${mobileOpen ? " open" : ""}`} onClick={() => setMobileOpen(false)} />
        <nav className="sidebar" style={{ width: `${RAIL_WIDTH}px`, overflow: "visible" }}>
          {/* Brand icon only */}
          <div style={{ padding: "0.875rem 0", borderBottom: "1px solid #292524", display: "flex", justifyContent: "center", flexShrink: 0 }}>
            <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "#b91c1c", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
          </div>

          {/* Icon links */}
          <div className="sidebar-nav-scroll" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", minHeight: 0, padding: "0.5rem 0" }}>
            {NAV.map(section => {
              if (!canSee(section.roles)) return null;
              if (section.section === "Production" && section.items.length === 0) return null;
              return section.items.map(item => {
                if (!canSee(item.roles ?? null)) return null;
                const active = mounted && isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={item.label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "100%",
                      height: "36px",
                      borderLeft: active ? "3px solid #b91c1c" : "3px solid transparent",
                      color: active ? "#fff" : "#a8a29e",
                      background: active ? "#292524" : "transparent",
                      textDecoration: "none",
                      transition: "background 0.12s, color 0.12s",
                    }}
                    onMouseEnter={e => {
                      if (!active) {
                        (e.currentTarget as HTMLElement).style.background = "#292524";
                        (e.currentTarget as HTMLElement).style.color = "#f5f5f4";
                      }
                    }}
                    onMouseLeave={e => {
                      if (!active) {
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                        (e.currentTarget as HTMLElement).style.color = "#a8a29e";
                      }
                    }}
                  >
                    <span style={{ opacity: active ? 1 : 0.7, display: "flex" }}>{item.icon}</span>
                  </Link>
                );
              });
            })}
          </div>

          {/* Floating expand tab — protrudes from right edge, vertically centred */}
          <button
            onClick={() => setRail(false)}
            title="Expand sidebar"
            style={{
              position: "absolute",
              top: "50%",
              right: "-14px",
              transform: "translateY(-50%)",
              width: "14px",
              height: "56px",
              background: "#292524",
              border: "none",
              borderRadius: "0 6px 6px 0",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#78716c",
              zIndex: 50,
              padding: 0,
              transition: "background 0.15s, color 0.15s",
            }}
            onMouseEnter={e => {
              (e.currentTarget.style.background = "#3c3533");
              (e.currentTarget.style.color = "#e7e5e4");
            }}
            onMouseLeave={e => {
              (e.currentTarget.style.background = "#292524");
              (e.currentTarget.style.color = "#78716c");
            }}
          >
            <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 1 7 6 1 11"/>
            </svg>
          </button>
        </nav>
      </>
    );
  }

  // ── Full sidebar ──────────────────────────────────────────────────────────
  return (
    <>
      {/* Mobile hamburger button */}
      <button className="mobile-menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open menu">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>

      {/* Overlay backdrop */}
      <div className={`sidebar-overlay${mobileOpen ? " open" : ""}`} onClick={() => setMobileOpen(false)} />

    <nav className={`sidebar${mobileOpen ? " mobile-open" : ""}`}>
      {/* Brand */}
      <div style={{ padding: "1.125rem 1rem", borderBottom: "1px solid #292524", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
            <div style={{
              width: "34px", height: "34px", borderRadius: "8px",
              background: "#b91c1c", display: "flex", alignItems: "center",
              justifyContent: "center", flexShrink: 0,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: "1rem", color: "#f5f5f4", letterSpacing: "-0.02em" }}>Tracey</div>
              <div style={{ fontSize: "0.6875rem", color: "#78716c", lineHeight: 1.2 }}>{tenantName}</div>
            </div>
          </div>
          {/* Collapse / close button */}
          <button
            onClick={() => mobileOpen ? setMobileOpen(false) : setRail(true)}
            title={mobileOpen ? "Close menu" : "Collapse sidebar"}
            style={{ background: "none", border: "none", color: "#3c3533", cursor: "pointer", padding: "0.25rem", display: "flex", borderRadius: "0.25rem", transition: "color 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#78716c")}
            onMouseLeave={e => (e.currentTarget.style.color = "#3c3533")}
          >
            {mobileOpen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            ) : (
              /* panel-left-close icon */
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Nav — scrollable */}
      <div suppressHydrationWarning className="sidebar-nav-scroll" style={{ padding: "0.375rem 0.5rem", flex: 1, overflowY: "auto", minHeight: 0 }}>
        {NAV.map(section => {
          if (!canSee(section.roles)) return null;
          if (section.section === "Production" && section.items.length === 0) return null;

          const isCollapsed = mounted && !!collapsed[section.section];

          return (
            <div key={section.section} style={{ marginBottom: "0.125rem" }}>
              {/* Section header — collapsible */}
              <button
                suppressHydrationWarning
                onClick={() => toggleSection(section.section)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", padding: "0.625rem 0.5rem 0.375rem",
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: "0.8125rem", fontWeight: 700,
                  color: "#e7e5e4", textTransform: "uppercase", letterSpacing: "0.06em",
                  borderRadius: "0.25rem",
                  marginTop: "0.25rem",
                }}
                onMouseEnter={e => (e.currentTarget.style.color = "#fafaf9")}
                onMouseLeave={e => (e.currentTarget.style.color = "#e7e5e4")}
              >
                <span>{section.section}</span>
                <Chevron collapsed={isCollapsed} />
              </button>

              {/* Links */}
              {!isCollapsed && (
                <div style={{ marginBottom: "0.25rem" }}>
                  {section.items.map(item => {
                    if (!canSee(item.roles ?? null)) return null;
                    const active = mounted && isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          paddingTop: PAD.top,
                          paddingBottom: PAD.bottom,
                          paddingRight: PAD.right,
                          paddingLeft: active ? PAD.active : PAD.inactive,
                          borderLeft: active ? "3px solid #b91c1c" : "3px solid transparent",
                          borderRadius: "0.375rem",
                          fontSize: "0.8125rem",
                          fontWeight: active ? 700 : 400,
                          textDecoration: "none",
                          transition: "background 0.12s, color 0.12s",
                          color: active ? "#fff" : "#a8a29e",
                          background: active ? "#292524" : "transparent",
                        }}
                        onMouseEnter={e => {
                          if (!active) {
                            (e.currentTarget as HTMLElement).style.background = "#292524";
                            (e.currentTarget as HTMLElement).style.color = "#f5f5f4";
                          }
                        }}
                        onMouseLeave={e => {
                          if (!active) {
                            (e.currentTarget as HTMLElement).style.background = "transparent";
                            (e.currentTarget as HTMLElement).style.color = "#a8a29e";
                          }
                        }}
                      >
                        <span style={{ flexShrink: 0, opacity: active ? 1 : 0.6, display: "flex" }}>
                          {item.icon}
                        </span>
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid #292524", padding: "0.75rem 1rem", flexShrink: 0 }}>
        <div style={{ fontSize: "0.6875rem", color: "#57534e", marginBottom: "0.5rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {userEmail}
        </div>
        <form action={signOut}>
          <button type="submit" style={{
            width: "100%", padding: "0.375rem 0.625rem", borderRadius: "0.375rem",
            background: "transparent", border: "1px solid #292524", color: "#78716c",
            fontSize: "0.75rem", cursor: "pointer", textAlign: "left",
          }}>
            Sign out
          </button>
        </form>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        style={{ position: "absolute", top: 0, right: 0, width: "4px", height: "100%", cursor: "col-resize", zIndex: 10 }}
      />
    </nav>
    </>
  );
}
