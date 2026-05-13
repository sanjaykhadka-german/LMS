import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import SpecEditor from "../_components/spec-editor";

export default async function SpecDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles").select("role, tenant_id, full_name").eq("id", user.id).single();

  const { id } = await params;

  const { data: spec } = await supabase
    .from("product_specs")
    .select(`
      id, version, version_label, status, approved_at, internal_notes,
      spec_storage_temp, spec_shelf_life, spec_notes, spec_origin,
      spec_fat_content, spec_protein, spec_moisture, spec_ph,
      spec_water_activity, spec_micro, spec_packaging, spec_labelling,
      ingredients_statement, country_of_origin, heating_instructions,
      min_life_on_receival_days, pack_tare_weight_inner_g, barcode_override,
      storage_class, nutrition_lab_tested,
      nut_energy_kj, nut_energy_kcal, nut_protein_g, nut_fat_total_g,
      nut_fat_saturated_g, nut_fat_trans_g, nut_carbs_total_g, nut_carbs_sugars_g,
      nut_fibre_g, nut_sodium_mg, nut_per_serving_g, nut_notes,
      allergens, created_at, updated_at,
      item:item_id(
        id, code, name, item_type, department, unit,
        weight_mode, is_rte, nip_large_item,
        target_weight_g, fill_weight_g, units_per_inner, inner_per_outer, units_per_outer, units_per_pallet,
        spec_storage_temp, spec_shelf_life, spec_notes, spec_origin,
        spec_fat_content, spec_protein, spec_moisture, spec_ph,
        spec_water_activity, spec_micro, spec_packaging, spec_labelling,
        nut_energy_kj, nut_energy_kcal, nut_protein_g, nut_fat_total_g,
        nut_fat_saturated_g, nut_fat_trans_g, nut_carbs_total_g, nut_carbs_sugars_g,
        nut_fibre_g, nut_sodium_mg, nut_per_serving_g, nut_notes,
        allergens
      ),
      approver:approved_by(id, full_name),
      creator:created_by(id, full_name),
      sends:spec_sends(
        id, document_type, sent_at, version_label, recipient_name, recipient_email, notes,
        customer:customer_id(id, name),
        sender:sent_by(id, full_name)
      )
    `)
    .eq("id", id)
    .single();

  if (!spec) notFound();

  // Pallet config for item
  const { data: palletConfig } = await supabase
    .from("item_pallet_config")
    .select("*")
    .eq("item_id", (spec.item as any)?.id)
    .single();

  // Images for item
  const { data: images } = await supabase
    .from("spec_images")
    .select("id, image_type, storage_path, public_url, caption, display_order")
    .eq("item_id", (spec.item as any)?.id)
    .order("display_order");

  // How many versions exist for this item (for next version number)
  const { count } = await supabase
    .from("product_specs")
    .select("id", { count: "exact", head: true })
    .eq("item_id", (spec.item as any)?.id);

  return (
    <SpecEditor
      mode="edit"
      spec={spec as any}
      prefillItem={(spec.item as any) ?? null}
      nextVersion={(count ?? 0) + 1}
      palletConfig={palletConfig ?? null}
      images={images ?? []}
      userId={user.id}
      tenantId={profile?.tenant_id ?? ""}
      userRole={profile?.role ?? "viewer"}
    />
  );
}
