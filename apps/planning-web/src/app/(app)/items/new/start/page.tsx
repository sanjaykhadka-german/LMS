import { createClient } from "@/lib/supabase/server";
import PickTypeCards from "./_components/pick-type-cards";
import { TENANT_FULL_FETCH } from "@/lib/limits";

/**
 * Pick-type entry screen for adding a new item.
 *
 * Step 1 of the new-item flow. Asks the operator what kind of product
 * they're adding (Resold / 1-step recipe / Multi-step recipe / Clone
 * existing). Each option routes onward to the right form — usually
 * `/items/new` with an `archetype` hint that pre-selects sensible
 * defaults (item_type, procurement_type).
 *
 * The existing `/items/new` route still works directly — this screen
 * is the new front door, not a replacement.
 */
export default async function PickTypePage() {
  const supabase = await createClient();
  // Items list for the inline "Clone existing" picker. Capped at the
  // tenant fetch limit (5k) which is fine for any realistic tenant.
  const { data: items } = await supabase
    .from("items")
    .select("id, code, name, item_type, is_active")
    .order("code")
    .limit(TENANT_FULL_FETCH);
  return <PickTypeCards items={items ?? []} />;
}
