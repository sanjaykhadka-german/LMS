import Link from "next/link";

/**
 * Single source of truth for the in-page quick-nav pills (Item Master, BOM List, ...).
 * Used at the top of every detail page so the look and feel never drifts.
 *
 * To change the visual treatment of these buttons across the entire app,
 * edit this file ONLY — every consumer (Item detail, BOM detail, Stocktake
 * detail, etc.) picks the new style up automatically.
 */

export type QuickNavTarget = "items" | "bom" | "stocktakes" | "orders" | "suppliers" | "customers";

interface QuickNavLinkSpec {
  href: string;
  label: string;
  emoji: string;
}

const TARGETS: Record<QuickNavTarget, QuickNavLinkSpec> = {
  items:      { href: "/items",       label: "Item Master", emoji: "📦" },
  bom:        { href: "/bom",         label: "BOM List",    emoji: "🧾" },
  stocktakes: { href: "/stocktakes",  label: "Stocktakes",  emoji: "📋" },
  orders:     { href: "/orders",      label: "Orders",      emoji: "🧺" },
  suppliers:  { href: "/settings/suppliers", label: "Suppliers", emoji: "🏭" },
  customers:  { href: "/customers",   label: "Customers",   emoji: "👥" },
};

const PILL_STYLE: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  padding: "0.25rem 0.625rem",
  borderRadius: "9999px",
  border: "1px solid #e7e5e4",
  background: "#fff",
  color: "#1c1917",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: "0.3rem",
  whiteSpace: "nowrap",
};

/**
 * Render a row of quick-nav pills.
 *
 * Defaults to ["items", "bom"] — the two registers most useful to jump
 * between on every detail page.
 */
export function QuickNav({
  targets = ["items", "bom"],
}: {
  targets?: QuickNavTarget[];
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
      {targets.map(key => {
        const t = TARGETS[key];
        return (
          <Link key={key} href={t.href} style={PILL_STYLE}>
            <span aria-hidden>{t.emoji}</span>
            {t.label}
          </Link>
        );
      })}
    </span>
  );
}
