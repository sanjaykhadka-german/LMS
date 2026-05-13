import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

const SETTINGS_SECTIONS = [
  {
    group: "Supply Chain",
    items: [
      { href: "/settings/suppliers", label: "Suppliers", description: "Manage supplier records, contacts, and certifications", roles: ["admin","manager"] },
    ],
  },
  {
    group: "Compliance",
    items: [
      { href: "/settings/allergens", label: "Allergens", description: "Configure allergen standards (FSANZ, EU, FDA) and active declarations", roles: ["admin","manager"] },
      { href: "/settings/ingredient-classifications", label: "Ingredient Classifications", description: "FSANZ-aligned classes (Mineral Salt, Antioxidant, Spice…) used to group the spec ingredients statement", roles: ["admin","manager"] },
      { href: "/settings/tax-codes", label: "Tax Codes", description: "GST and tax code setup for purchases and sales", roles: ["admin","manager"] },
      { href: "/settings/barcodes", label: "GS1 Barcode Pool", description: "Manage your GS1-allocated barcode inventory and assign to items", roles: ["admin","manager"] },
    ],
  },
  {
    group: "Operations",
    items: [
      { href: "/settings/departments", label: "Departments", description: "Production areas used across the planning app", roles: ["admin","manager"] },
      { href: "/settings/machines", label: "Machines & Equipment", description: "Equipment register, maintenance schedules, and breakdowns", roles: ["admin","manager"] },
      { href: "/settings/units-of-measure", label: "Units of Measure", description: "Tenant-wide UOM register — kg / each / litre / etc. Renaming a UOM updates everywhere", roles: ["admin","manager"] },
      { href: "/settings/pack-levels", label: "Pack Hierarchy Levels", description: "Named levels in your pack hierarchy (Inner / Sub-outer / Outer / Pallet by default). Add or rename to fit your operation.", roles: ["admin","manager"] },
    ],
  },
  {
    group: "Sales",
    items: [
      { href: "/settings/price-groups", label: "Price Groups", description: "Manage price groups and set per-item prices for retail, wholesale, and export", roles: ["admin","manager"] },
    ],
  },
  {
    group: "Administration",
    items: [
      { href: "/settings/tenant", label: "Business Settings", description: "Invoice branding, prefix, templates, and multi-currency options", roles: ["admin","super_admin"] },
      { href: "/settings/vocabulary", label: "Vocabulary", description: "Rename system labels (Stage, Ingredient, Product, etc.) to match how your team talks. Changes apply tenant-wide.", roles: ["admin","super_admin"] },
      { href: "/settings/users", label: "Users & Permissions", description: "Invite staff, manage roles, activate or deactivate accounts", roles: ["admin","manager"] },
      { href: "/settings/user-categories", label: "User Categories", description: "Define categories for classifying staff, contractors, and contacts", roles: ["admin"] },
      { href: "/settings/audit", label: "Audit Log", description: "Full history of all changes made in the system", roles: ["admin"] },
    ],
  },
];

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .single();

  const role = profile?.role ?? "viewer";

  if (!["admin", "manager", "super_admin"].includes(role)) {
    redirect("/dashboard");
  }

  return (
    <div style={{ maxWidth: "860px" }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure your workspace, team, and compliance settings</p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
        {SETTINGS_SECTIONS.map(group => {
          const visible = group.items.filter(i => i.roles.includes(role));
          if (visible.length === 0) return null;
          return (
            <div key={group.group}>
              <h2 style={{ fontSize: "0.75rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase",
                letterSpacing: "0.06em", margin: "0 0 0.625rem" }}>
                {group.group}
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem" }}>
                {visible.map(item => (
                  <Link key={item.href} href={item.href} className="settings-card-link">
                    <div className="card settings-card">
                      <div style={{ fontWeight: 600, fontSize: "0.9375rem", color: "#1c1917", marginBottom: "0.25rem" }}>
                        {item.label}
                      </div>
                      <div style={{ fontSize: "0.8125rem", color: "#78716c", lineHeight: 1.45 }}>
                        {item.description}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
