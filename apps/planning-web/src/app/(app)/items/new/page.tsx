import { createClient } from "@/lib/supabase/server";
import ItemForm from "../_components/item-form";

/**
 * The "New Item" page accepts an optional ?duplicate_from=<itemId> query
 * param. When present, the source item is fetched and used to pre-fill the
 * form — minus the identity fields the user must re-enter for the copy:
 *
 *   • code — must be unique, blanked
 *   • current_stock — copy starts at 0 by default
 *   • id — auto-generated on save, never copied
 *
 * Item-level rows in linked tables (barcodes, images, BOMs, suppliers,
 * product_specs) are NOT copied — those stay attached to the source. The
 * operator can re-create or re-link them on the duplicate.
 */

export default async function NewItemPage({
  searchParams,
}: {
  searchParams?: Promise<{ duplicate_from?: string; archetype?: string }>;
}) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user!.id)
    .single();

  const sp = searchParams ? await searchParams : undefined;
  const duplicateFromId = sp?.duplicate_from ?? null;
  const archetype = (sp?.archetype as "resold" | "1step" | "multistep" | undefined) ?? null;

  // Fetch the source item when we're in duplicate mode. We strip the
  // identity fields here so the form never sees them and can't accidentally
  // round-trip the old code on save.
  let initialFromDuplicate: Record<string, unknown> | undefined = undefined;
  let duplicateSourceLabel: string | null = null;
  if (duplicateFromId) {
    const { data: src } = await supabase
      .from("items")
      .select("*")
      .eq("id", duplicateFromId)
      .eq("tenant_id", profile!.tenant_id)
      .single();
    if (src) {
      duplicateSourceLabel = `${src.code} — ${src.name}`;
      // Build the seed without the per-item identity fields.
      const stripped = { ...src } as Record<string, unknown>;
      delete stripped.id;
      delete stripped.code;
      delete stripped.created_at;
      delete stripped.updated_at;
      delete stripped.current_stock;
      // Keep parent_item_id, item_type, departments, packaging, weights,
      // allergens, micro panel, nutrition — everything else copies as-is.
      initialFromDuplicate = stripped;
    }
  }

  const { data: tenantSettings } = await supabase
    .from("tenant_allergen_settings")
    .select("active_standards")
    .eq("tenant_id", profile!.tenant_id)
    .single();

  const activeStandards: string[] = tenantSettings?.active_standards ?? ["FSANZ"];

  const { data: allergenDefs } = await supabase
    .from("allergen_definitions")
    .select("code, name, regulatory_standard")
    .in("regulatory_standard", activeStandards)
    .eq("is_active", true)
    .order("regulatory_standard")
    .order("sort_order");

  const [{ data: departments }, { data: machinesRaw }, { data: categories }, { data: subcategories }, { data: itemTypes }, { data: uoms }] = await Promise.all([
    supabase.from("departments").select("id, name, code").eq("tenant_id", profile!.tenant_id).eq("is_active", true).order("sort_order").order("name"),
    // Pull each machine's room + department so the item form can auto-fill
    // those two fields when a machine is selected (task #64).
    supabase.from("machines").select("id, name, code, room:room_id(id, name), department:department_id(id, name)").eq("tenant_id", profile!.tenant_id).eq("is_active", true).order("name"),
    supabase.from("item_categories").select("id, name, color").eq("tenant_id", profile!.tenant_id).eq("is_active", true).order("sort_order").order("name"),
    supabase.from("item_subcategories").select("id, category_id, name").eq("tenant_id", profile!.tenant_id).eq("is_active", true).order("sort_order").order("name"),
    supabase.from("item_types").select("id, code, name, color, is_purchasable, can_have_bom, is_sellable, is_producible, sort_order, is_active").eq("tenant_id", profile!.tenant_id).eq("is_active", true).order("sort_order"),
    supabase.from("units_of_measure").select("code, name, category").eq("tenant_id", profile!.tenant_id).eq("is_active", true).order("sort_order").order("code"),
  ]);

  // Normalise Supabase's relation-as-array quirk — joined rows can come
  // back as either an object or a single-element array depending on the
  // FK shape. Coerce to single object so the form code stays simple.
  type MachineRow = {
    id: string; name: string; code: string | null;
    room: { id: string; name: string } | { id: string; name: string }[] | null;
    department: { id: string; name: string } | { id: string; name: string }[] | null;
  };
  const machines = ((machinesRaw ?? []) as MachineRow[]).map(m => ({
    id: m.id, name: m.name, code: m.code,
    room: Array.isArray(m.room) ? (m.room[0] ?? null) : m.room,
    department: Array.isArray(m.department) ? (m.department[0] ?? null) : m.department,
  }));

  const archetypeBanner = archetype ? (() => {
    const titles: Record<string, { label: string; hint: string; color: string }> = {
      resold:    { label: "Resold item",       hint: "You buy this and resell as-is. Set procurement = Purchased and pick a supplier on the next page.", color: "#1e40af" },
      "1step":   { label: "1-step recipe",      hint: "Combine ingredients in one go. After saving, click '+ Create BOM' to define the recipe.", color: "#0f6e56" },
      multistep: { label: "Multi-step recipe",  hint: "Multiple production stages. After saving, the BOM editor lets you build the cascade.", color: "#993c1d" },
    };
    const t = titles[archetype];
    if (!t) return null;
    return (
      <div style={{
        padding: "0.625rem 0.875rem",
        marginBottom: "1rem",
        background: "#fef9c3",
        border: "1px solid #fde68a",
        borderRadius: "0.5rem",
        fontSize: "0.8125rem",
        color: "#713f12",
      }}>
        <strong style={{ color: t.color }}>{t.label}</strong> · {t.hint}{" "}
        <a href="/items/new/start" style={{ color: "#b91c1c", textDecoration: "none", fontWeight: 600, marginLeft: "0.25rem" }}>
          Change type ↺
        </a>
      </div>
    );
  })() : null;

  return (
    <>
      {archetypeBanner}
      <ItemForm
      mode="create"
      initial={initialFromDuplicate as Parameters<typeof ItemForm>[0]["initial"]}
      duplicateSourceLabel={duplicateSourceLabel}
      allergenDefs={allergenDefs ?? []}
      departments={departments ?? []}
      machines={machines}
      categories={categories ?? []}
      subcategories={subcategories ?? []}
      itemTypes={itemTypes ?? []}
      uoms={uoms ?? []}
    />
    </>
  );
}
