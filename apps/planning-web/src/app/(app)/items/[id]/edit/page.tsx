import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import ItemForm from "../../_components/item-form";
import type { Item } from "@/lib/types";

export default async function EditItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ from_duplicate?: string; back_to_test?: string; qty?: string; uom?: string }>;
}) {
  const { id } = await params;
  const sp = searchParams ? await searchParams : undefined;
  const fromDuplicate = sp?.from_duplicate === "1";
  const backToTestId  = sp?.back_to_test ?? null;
  const restoredQty   = sp?.qty ?? "";
  const restoredUom   = sp?.uom ?? "";
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user!.id)
    .single();

  const [{ data: item }, { data: tenantSettings }] = await Promise.all([
    supabase.from("items").select("*").eq("id", id).single(),
    supabase.from("tenant_allergen_settings").select("active_standards").eq("tenant_id", profile!.tenant_id).single(),
  ]);

  if (!item) notFound();

  const activeStandards: string[] = tenantSettings?.active_standards ?? ["FSANZ"];

  const [{ data: allergenDefs }, { data: departments }, { data: machinesRaw }, { data: categories }, { data: subcategories }, { data: itemTypes }, { data: uoms }] = await Promise.all([
    supabase.from("allergen_definitions").select("code, name, regulatory_standard").in("regulatory_standard", activeStandards).eq("is_active", true).order("regulatory_standard").order("sort_order"),
    supabase.from("departments").select("id, name, code").eq("tenant_id", profile!.tenant_id).eq("is_active", true).order("sort_order").order("name"),
    // Pull each machine's room + department so the item form can auto-fill
    // those two fields when a machine is selected (task #64).
    supabase.from("machines").select("id, name, code, room:room_id(id, name), department:department_id(id, name)").eq("tenant_id", profile!.tenant_id).eq("is_active", true).order("name"),
    supabase.from("item_categories").select("id, name, color").eq("tenant_id", profile!.tenant_id).eq("is_active", true).order("sort_order").order("name"),
    supabase.from("item_subcategories").select("id, category_id, name").eq("tenant_id", profile!.tenant_id).eq("is_active", true).order("sort_order").order("name"),
    supabase.from("item_types").select("id, code, name, color, is_purchasable, can_have_bom, is_sellable, is_producible, sort_order, is_active").eq("tenant_id", profile!.tenant_id).eq("is_active", true).order("sort_order"),
    supabase.from("units_of_measure").select("code, name, category").eq("tenant_id", profile!.tenant_id).eq("is_active", true).order("sort_order").order("code"),
  ]);

  // Normalise Supabase's relation-as-array quirk on machine.room and
  // machine.department so the form receives a consistent {id, name} shape.
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

  // If we arrived from a "Test this product" modal, build the URL to return to it
  const backUrl = backToTestId
    ? `/items/${backToTestId}?openTest=1${restoredQty ? `&qty=${restoredQty}` : ""}${restoredUom ? `&uom=${restoredUom}` : ""}`
    : null;

  return (
    <>
      {backUrl && (
        <a
          href={backUrl}
          style={{
            display: "flex", alignItems: "center", gap: "0.625rem",
            padding: "0.625rem 0.875rem", marginBottom: "1rem",
            background: "linear-gradient(90deg, #fef2f2, #fef9c3)",
            border: "1px solid #fde68a",
            borderRadius: "0.5rem",
            textDecoration: "none",
            color: "#854d0e",
            fontSize: "0.875rem",
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: "1rem" }}>←</span>
          <span>Save your edits, then click here to <strong style={{ color: "#1c1917" }}>resume the test</strong></span>
          <span style={{ marginLeft: "auto", color: "#b91c1c", fontSize: "0.75rem", fontWeight: 600 }}>
            Re-open test →
          </span>
        </a>
      )}
    <ItemForm
      mode="edit"
      initial={item as Partial<Item>}
      // When the edit page is reached via "Duplicate Item" → server action,
      // surface a blue banner reminding the operator to set a real code,
      // activate the item, and re-link BOMs / suppliers / barcodes manually.
      duplicateSourceLabel={fromDuplicate
        ? "another item — this is a draft copy. Replace the placeholder code, re-link BOMs / suppliers / barcodes, then activate."
        : null}
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
