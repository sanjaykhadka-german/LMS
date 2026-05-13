"use server";

/**
 * Server actions for /purchasing.
 *
 * 1. saveQuickFix       — write changes from the row-click "Quick fix" modal
 *                         (stock, min, max, default supplier, cost override).
 * 2. saveSupplierLink   — create/update a supplier_items row from inside the
 *                         split-order modal's "+ Add new supplier" inline form
 *                         (modeled on the existing /items/[id] Link-a-Supplier).
 * 3. addDraftLine       — append (or stack onto) a po_draft_lines row.
 * 4. removeDraftLine    — delete one line.
 * 5. clearDraft         — wipe the current open draft.
 * 6. submitDraft        — convert the open draft → purchase_orders + po_lines,
 *                         one PO per supplier, mark draft as submitted.
 *
 * All actions run server-side, RLS-scoped, and revalidate /purchasing.
 */

import { createClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/tenant";
import { revalidatePath } from "next/cache";

// ─── 1. Quick fix ────────────────────────────────────────────
export async function saveQuickFix(input: {
  item_id: string;
  current_stock?: number | null;
  min_stock?:     number | null;
  max_stock?:     number | null;
  standard_cost?: number | null;
  default_supplier_id?: string | null; // mark this supplier_items row as is_preferred
}): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) return { error: "Tenant not found" };

  const patch: Record<string, unknown> = {};
  if (input.current_stock != null) patch.current_stock = input.current_stock;
  if (input.min_stock     != null) patch.min_stock     = input.min_stock;
  if (input.max_stock     != null) patch.max_stock     = input.max_stock;
  if (input.standard_cost != null) patch.standard_cost = input.standard_cost;

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from("items")
      .update(patch)
      .eq("id", input.item_id)
      .eq("tenant_id", tenantId);
    if (error) return { error: error.message };
  }

  if (input.default_supplier_id) {
    // Clear preferred on all supplier_items for this item, then set on the chosen one.
    await supabase
      .from("supplier_items")
      .update({ is_preferred: false })
      .eq("item_id", input.item_id)
      .eq("tenant_id", tenantId);
    const { error: e2 } = await supabase
      .from("supplier_items")
      .update({ is_preferred: true })
      .eq("item_id", input.item_id)
      .eq("supplier_id", input.default_supplier_id)
      .eq("tenant_id", tenantId);
    if (e2) return { error: e2.message };
  }

  revalidatePath("/purchasing");
  return { ok: true };
}

// ─── 2. Supplier link (create or update) ─────────────────────
export async function saveSupplierLink(input: {
  id?: string | null; // if present → update, else insert
  item_id: string;
  supplier_id: string;
  supplier_item_code?: string | null;
  supplier_item_name?: string | null;
  unit_price?: number | null;
  currency?: string | null;
  purchase_uom?: string | null;
  purchase_uom_qty?: number | null;
  min_order_qty?: number | null;
  lead_time_days?: number | null;
  is_preferred?: boolean | null;
  notes?: string | null;
  price_valid_from?: string | null;
  price_valid_to?: string | null;
}): Promise<{ ok: true; id: string } | { error: string }> {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) return { error: "Tenant not found" };

  const row = {
    tenant_id:         tenantId,
    item_id:           input.item_id,
    supplier_id:       input.supplier_id,
    supplier_item_code: input.supplier_item_code ?? null,
    supplier_item_name: input.supplier_item_name ?? null,
    unit_price:        input.unit_price ?? null,
    currency:          input.currency ?? "AUD",
    purchase_uom:      input.purchase_uom ?? null,
    purchase_uom_qty:  input.purchase_uom_qty ?? null,
    min_order_qty:     input.min_order_qty ?? null,
    lead_time_days:    input.lead_time_days ?? null,
    is_preferred:      input.is_preferred ?? false,
    notes:             input.notes ?? null,
    price_valid_from:  input.price_valid_from ?? null,
    price_valid_to:    input.price_valid_to ?? null,
  };

  if (input.id) {
    const { error } = await supabase
      .from("supplier_items")
      .update(row)
      .eq("id", input.id)
      .eq("tenant_id", tenantId);
    if (error) return { error: error.message };
    revalidatePath("/purchasing");
    return { ok: true, id: input.id };
  }

  const { data, error } = await supabase
    .from("supplier_items")
    .insert(row)
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/purchasing");
  return { ok: true, id: data.id };
}

// ─── Draft helpers ───────────────────────────────────────────
async function getOpenDraftId(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_or_create_open_draft");
  if (error || !data) return null;
  return data as string;
}

// ─── 3. Add (or stack) a draft line ──────────────────────────
export async function addDraftLine(input: {
  item_id: string;
  supplier_id: string;
  qty: number;
  unit: string;
  unit_price?: number | null;
  purchase_uom?: string | null;
  purchase_uom_qty?: number | null;
  notes?: string | null;
}): Promise<{ ok: true; line_id: string } | { error: string }> {
  const supabase = await createClient();
  const draftId = await getOpenDraftId();
  if (!draftId) return { error: "Could not create draft" };

  // If a line for this (item, supplier) already exists, stack qty.
  const { data: existing } = await supabase
    .from("po_draft_lines")
    .select("id, qty")
    .eq("draft_id", draftId)
    .eq("item_id", input.item_id)
    .eq("supplier_id", input.supplier_id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("po_draft_lines")
      .update({
        qty:              Number(existing.qty) + input.qty,
        unit_price:       input.unit_price ?? null,
        purchase_uom:     input.purchase_uom ?? null,
        purchase_uom_qty: input.purchase_uom_qty ?? null,
        notes:            input.notes ?? null,
        updated_at:       new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) return { error: error.message };
    revalidatePath("/purchasing");
    return { ok: true, line_id: existing.id };
  }

  const { data, error } = await supabase
    .from("po_draft_lines")
    .insert({
      draft_id:         draftId,
      item_id:          input.item_id,
      supplier_id:      input.supplier_id,
      qty:              input.qty,
      unit:             input.unit,
      unit_price:       input.unit_price ?? null,
      purchase_uom:     input.purchase_uom ?? null,
      purchase_uom_qty: input.purchase_uom_qty ?? null,
      notes:            input.notes ?? null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/purchasing");
  return { ok: true, line_id: data.id };
}

// ─── 3b. Replace ALL lines for one item ─────────────────────
// Used when the SplitOrderModal opens an item that already has cart lines —
// the user is editing the planned split, not stacking onto it. Atomic-ish:
// delete the old lines for this item in the open draft, then insert the new.
export async function replaceDraftLinesForItem(
  item_id: string,
  newLines: Array<{
    supplier_id: string;
    qty: number;
    unit: string;
    unit_price?: number | null;
    purchase_uom?: string | null;
    purchase_uom_qty?: number | null;
  }>,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const draftId = await getOpenDraftId();
  if (!draftId) return { error: "Could not create draft" };

  const { error: delErr } = await supabase
    .from("po_draft_lines")
    .delete()
    .eq("draft_id", draftId)
    .eq("item_id", item_id);
  if (delErr) return { error: delErr.message };

  if (newLines.length === 0) {
    revalidatePath("/purchasing");
    return { ok: true };
  }

  const rows = newLines.map(l => ({
    draft_id:         draftId,
    item_id,
    supplier_id:      l.supplier_id,
    qty:              l.qty,
    unit:             l.unit,
    unit_price:       l.unit_price ?? null,
    purchase_uom:     l.purchase_uom ?? null,
    purchase_uom_qty: l.purchase_uom_qty ?? null,
  }));
  const { error: insErr } = await supabase.from("po_draft_lines").insert(rows);
  if (insErr) return { error: insErr.message };

  revalidatePath("/purchasing");
  return { ok: true };
}

// ─── 4. Remove a draft line ──────────────────────────────────
export async function removeDraftLine(line_id: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("po_draft_lines").delete().eq("id", line_id);
  if (error) return { error: error.message };
  revalidatePath("/purchasing");
  return { ok: true };
}

// ─── 5. Clear the open draft ─────────────────────────────────
export async function clearDraft(): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const draftId = await getOpenDraftId();
  if (!draftId) return { ok: true };
  const { error } = await supabase.from("po_draft_lines").delete().eq("draft_id", draftId);
  if (error) return { error: error.message };
  revalidatePath("/purchasing");
  return { ok: true };
}

// ─── 6. Submit draft → purchase_orders + po_lines ────────────
// Stub for now — wires later to the existing PO schema.
export async function submitDraft(): Promise<{ ok: true; created: { supplier_id: string; po_id: string }[] } | { error: string }> {
  const supabase = await createClient();
  const draftId = await getOpenDraftId();
  if (!draftId) return { error: "No draft" };
  await supabase.from("po_drafts").update({ status: "submitted" }).eq("id", draftId);
  revalidatePath("/purchasing");
  return { ok: true, created: [] };
}
