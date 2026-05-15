// Canonical label keys + system defaults, seeded by Supabase migration 109.
// Frozen here as TS constants because there's no per-tenant equivalent of the
// shared `public.label_canonical_keys` table in the Tracey monorepo — the
// tenant override table (pl_tenant_labels) is enough on its own. Adding a new
// canonical key = appending to this list.

export interface CanonicalLabel {
  canonical_key: string;
  default_label: string;
  description: string;
  example_locations: string;
  sort_order: number;
}

export const CANONICAL_LABELS: readonly CanonicalLabel[] = [
  {
    canonical_key: "step",
    default_label: "Stage",
    description: "A node in the production cascade",
    example_locations: "Production flow nodes, \"Add stage\" button, cascade diagrams",
    sort_order: 10,
  },
  {
    canonical_key: "ingredient",
    default_label: "Ingredient",
    description: "A weight-class component consumed by a recipe",
    example_locations: "Recipe rows, shopping list, raw material schedule",
    sort_order: 20,
  },
  {
    canonical_key: "product",
    default_label: "Product",
    description: "An item that gets sold to customers",
    example_locations: "Item types, sales screens, demand plans",
    sort_order: 30,
  },
  {
    canonical_key: "supply",
    default_label: "Packaging",
    description: "A non-food item: boxes, labels, films, components",
    example_locations: "Packaging hierarchy, BOM line types",
    sort_order: 40,
  },
  {
    canonical_key: "department",
    default_label: "Department",
    description: "Where a stage runs",
    example_locations: "Stage cards, scheduling kanbans",
    sort_order: 50,
  },
  {
    canonical_key: "process_loss",
    default_label: "Process loss",
    description: "Weight lost during a production step",
    example_locations: "Stage edit form, recipe configuration",
    sort_order: 60,
  },
  {
    canonical_key: "giveaway",
    default_label: "Average overpack",
    description: "When fill weight exceeds target weight",
    example_locations: "Stage edit form, item master",
    sort_order: 70,
  },
  {
    canonical_key: "tare",
    default_label: "Packaging weight (tare)",
    description: "Empty pack/container weight, deducted from gross",
    example_locations: "Item master",
    sort_order: 80,
  },
] as const;

export function isCanonicalKey(key: string): boolean {
  return CANONICAL_LABELS.some((c) => c.canonical_key === key);
}
