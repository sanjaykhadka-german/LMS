import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import BomWizard from "./_components/bom-wizard";
import { TENANT_FULL_FETCH } from "@/lib/limits";
import { fetchAllRows } from "@/lib/fetch-all";

/**
 * Guided BOM wizard for an item. Server-renders the parent item,
 * the available components list (filtered to plausible BOM components),
 * the units-of-measure register, and the next bom version number — then
 * hands everything to the client wizard.
 *
 * Entered from the item detail page via the "+ Guided BOM" button.
 */
export default async function BomWizardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", user!.id)
    .single();

  const [
    { data: item },
    { data: components },
    { data: uoms },
    { data: existingBoms },
  ] = await Promise.all([
    supabase.from("items").select("id, code, name, item_type, unit, target_weight_g, default_batch_size, batch_unit").eq("id", id).single(),
    fetchAllRows((from, to) => supabase
      .from("items")
      .select("id, code, name, item_type, unit")
      .eq("tenant_id", profile!.tenant_id)
      .eq("is_active", true)
      .neq("id", id)  // can't list yourself as a component
      .order("code")
      .range(from, to)),
    supabase.from("units_of_measure")
      .select("id, code, name, category")
      .eq("tenant_id", profile!.tenant_id)
      .eq("is_active", true)
      .order("sort_order").order("code"),
    supabase.from("bom_headers")
      .select("id, version")
      .eq("item_id", id)
      .order("version", { ascending: false })
      .limit(1),
  ]);

  if (!item) notFound();

  const nextVersion = (existingBoms?.[0]?.version ?? 0) + 1;

  return (
    <BomWizard
      tenantId={profile!.tenant_id}
      parent={item as { id: string; code: string; name: string; item_type: string; unit: string | null; target_weight_g: number | null; default_batch_size: number | null; batch_unit: string | null }}
      components={(components ?? []) as { id: string; code: string; name: string; item_type: string; unit: string | null }[]}
      uoms={(uoms ?? []) as { id: string; code: string; name: string; category: string | null }[]}
      nextVersion={nextVersion}
    />
  );
}
