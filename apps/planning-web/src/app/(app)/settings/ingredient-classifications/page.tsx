import { createClient } from "@/lib/supabase/server";
import ClassificationsManager from "./_components/classifications-manager";

/**
 * Ingredient classifications register (Phase 3H.2).
 *
 * Per-tenant FSANZ-aligned class list (Mineral Salt, Antioxidant, Spice…).
 * Drives the Class dropdown on the Item Master ingredient-component grid
 * (Phase 3H.3) and the grouping in the spec ingredients statement
 * (Phase 3H.4). Seeded on tenant creation by mig 098.
 */
export default async function IngredientClassificationsPage() {
  const supabase = await createClient();
  const { data: classifications } = await supabase
    .from("ingredient_classifications")
    .select("*")
    .order("sort_order")
    .order("label");

  return <ClassificationsManager initial={classifications ?? []} />;
}
