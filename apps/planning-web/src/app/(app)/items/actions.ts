"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Clone a single item into a new draft row, returning the new item's id.
 *
 * Behaviour (Tino, May 2026):
 *   • Every column on `items` is copied verbatim EXCEPT the identity fields:
 *       - id           — DB generates a fresh uuid.
 *       - code         — placeholder "COPY-<src>-<rand>". The unique
 *                        constraint requires a non-null + unique code, and
 *                        a placeholder lets us land in Item Master in
 *                        draft state. The user changes the code in the
 *                        Edit form before the item is used in production.
 *       - current_stock — duplicate starts empty.
 *       - is_active    — false. The draft is INVISIBLE on Item Master's
 *                        active-only filter until the operator activates
 *                        it from the edit form. Stops accidental use.
 *       - created_at / updated_at — DB defaults.
 *
 *   • Linked tables (item_barcodes, item_images, bom_headers, supplier_items,
 *     product_specs, item_pallet_config) are NOT touched. Those stay
 *     attached to the source. Re-link on the duplicate manually.
 *
 *   • Tenant isolation: we re-resolve the caller's tenant from the profile
 *     and ignore whatever tenant_id is in the source row, so this is safe
 *     against a manipulated source id.
 */
export async function duplicateItem(
  sourceItemId: string
): Promise<{ id?: string; error?: string }> {
  const supabase = await createClient();

  // Resolve caller → tenant. RLS would catch a cross-tenant read, but doing
  // it explicitly here means we can scope the placeholder code search too.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  if (!profile?.tenant_id) return { error: "Could not resolve your tenant." };

  // Load the source row.
  const { data: src, error: loadErr } = await supabase
    .from("items")
    .select("*")
    .eq("id", sourceItemId)
    .eq("tenant_id", profile.tenant_id)
    .single();
  if (loadErr) return { error: loadErr.message };
  if (!src) return { error: "Source item not found." };

  // Build the placeholder code. Try a few short random suffixes if the first
  // collides (very unlikely but cheap to handle).
  const baseCode = String(src.code ?? "ITEM").slice(0, 24); // keep total length sane
  let placeholder = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const rand = Math.random().toString(36).slice(2, 6);
    const candidate = `COPY-${baseCode}-${rand}`;
    const { count } = await supabase
      .from("items")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", profile.tenant_id)
      .eq("code", candidate);
    if ((count ?? 0) === 0) { placeholder = candidate; break; }
  }
  if (!placeholder) return { error: "Couldn't allocate a placeholder code — try again." };

  // Strip identity fields from the source and substitute the new ones.
  // Spread-and-overwrite avoids enumerating every column we want to copy
  // (the items table has 80+ of them and growing).
  const insertRow = { ...(src as Record<string, unknown>) };
  delete insertRow.id;
  delete insertRow.created_at;
  delete insertRow.updated_at;
  insertRow.code = placeholder;
  insertRow.current_stock = 0;
  insertRow.is_active = false;
  insertRow.tenant_id = profile.tenant_id;

  const { data: created, error: insErr } = await supabase
    .from("items")
    .insert(insertRow)
    .select("id")
    .single();
  if (insErr) return { error: insErr.message };

  revalidatePath("/items");
  return { id: created.id };
}
