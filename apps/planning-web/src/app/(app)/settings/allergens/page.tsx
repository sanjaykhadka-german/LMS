import { createClient } from "@/lib/supabase/server";
import AllergensManager from "./_components/allergens-manager";

export default async function AllergensPage() {
  const supabase = await createClient();

  const [{ data: allDefs }, { data: tenantSettings }] = await Promise.all([
    supabase
      .from("allergen_definitions")
      .select("*")
      .order("regulatory_standard")
      .order("sort_order"),
    supabase
      .from("tenant_allergen_settings")
      .select("*")
      .maybeSingle(),
  ]);

  return (
    <AllergensManager
      allDefinitions={allDefs ?? []}
      tenantSettings={tenantSettings}
    />
  );
}
