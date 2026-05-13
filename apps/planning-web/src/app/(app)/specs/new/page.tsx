import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SpecEditor from "../_components/spec-editor";

export default async function NewSpecPage({
  searchParams,
}: {
  searchParams: Promise<{ item_id?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles").select("role, tenant_id, full_name").eq("id", user.id).single();

  if (!profile || !["admin", "manager", "super_admin"].includes(profile.role)) redirect("/specs");

  const { item_id } = await searchParams;

  // Pre-load item if provided
  let prefillItem = null;
  if (item_id) {
    const { data } = await supabase
      .from("items")
      .select(`
        id, code, name, item_type, department, unit,
        spec_storage_temp, spec_shelf_life, spec_notes, spec_origin,
        spec_fat_content, spec_protein, spec_moisture, spec_ph,
        spec_water_activity, spec_micro, spec_packaging, spec_labelling,
        nut_energy_kj, nut_energy_kcal, nut_protein_g, nut_fat_total_g,
        nut_fat_saturated_g, nut_fat_trans_g, nut_carbs_total_g, nut_carbs_sugars_g,
        nut_fibre_g, nut_sodium_mg, nut_per_serving_g, nut_notes,
        allergens, target_weight_g, units_per_inner, inner_per_outer,
        units_per_outer
      `)
      .eq("id", item_id)
      .single();
    prefillItem = data;
  }

  // How many versions exist already for this item?
  let nextVersion = 1;
  if (item_id) {
    const { count } = await supabase
      .from("product_specs")
      .select("id", { count: "exact", head: true })
      .eq("item_id", item_id);
    nextVersion = (count ?? 0) + 1;
  }

  // Pallet config for item
  let palletConfig = null;
  if (item_id) {
    const { data } = await supabase
      .from("item_pallet_config")
      .select("*")
      .eq("item_id", item_id)
      .single();
    palletConfig = data;
  }

  // Existing images for item
  let images: any[] = [];
  if (item_id) {
    const { data } = await supabase
      .from("spec_images")
      .select("id, image_type, storage_path, public_url, caption, display_order")
      .eq("item_id", item_id)
      .order("display_order");
    images = data ?? [];
  }

  return (
    <SpecEditor
      mode="new"
      spec={null}
      prefillItem={prefillItem}
      nextVersion={nextVersion}
      palletConfig={palletConfig}
      images={images}
      userId={user.id}
      tenantId={profile.tenant_id}
      userRole={profile.role}
    />
  );
}
