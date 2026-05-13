import { createClient } from "@/lib/supabase/server";
import Wizard from "./_components/wizard";
import RmWizard from "./_components/rm-wizard";

/**
 * Guided wizards for adding new items. Branches on the `archetype`
 * query param:
 *   ?archetype=multistep | 1step  → finished-good wizard
 *   ?archetype=raw                 → raw material / packaging / consumable wizard
 *
 * The classic /items/new form remains as the fallback for direct entry
 * and the duplicate flow.
 */
export default async function WizardPage({
  searchParams,
}: {
  searchParams?: Promise<{ archetype?: string }>;
}) {
  const supabase = await createClient();
  const sp = searchParams ? await searchParams : undefined;
  const archetype = (sp?.archetype as "resold" | "1step" | "multistep" | "raw" | undefined) ?? "multistep";

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user!.id)
    .single();

  if (archetype === "raw") {
    const [{ data: rooms }, { data: suppliers }, { data: uoms }] = await Promise.all([
      supabase.from("rooms")
        .select("id, name, code")
        .eq("tenant_id", profile!.tenant_id)
        .eq("is_active", true)
        .order("sort_order").order("name"),
      supabase.from("suppliers")
        .select("id, name, code")
        .eq("tenant_id", profile!.tenant_id)
        .eq("is_active", true)
        .order("name"),
      supabase.from("units_of_measure")
        .select("id, code, name, category")
        .eq("tenant_id", profile!.tenant_id)
        .eq("is_active", true)
        .order("sort_order").order("code"),
    ]);
    return (
      <RmWizard
        tenantId={profile!.tenant_id}
        rooms={(rooms ?? []) as { id: string; name: string; code: string | null }[]}
        suppliers={(suppliers ?? []) as { id: string; name: string; code: string | null }[]}
        uoms={(uoms ?? []) as { id: string; code: string; name: string; category: string | null }[]}
      />
    );
  }

  // Default: finished-good wizard (1step / multistep / fallback)
  const { data: departments } = await supabase.from("departments")
    .select("id, name, code")
    .eq("tenant_id", profile!.tenant_id)
    .eq("is_active", true)
    .order("sort_order").order("name");

  return (
    <Wizard
      archetype={archetype as "resold" | "1step" | "multistep"}
      tenantId={profile!.tenant_id}
      departments={(departments ?? []) as { id: string; name: string; code: string | null }[]}
    />
  );
}
