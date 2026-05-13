"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ─── Production ───────────────────────────────────────────────────────────────

export async function updateProductionOrder(
  orderId: string,
  fields: {
    status?: string;
    actual_qty?: number | null;
    actual_pct_injected?: number | null;
    tumble_hours?: number | null;
    notes?: string | null;
    priority?: number;
  }
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("production_orders")
    .update(fields)
    .eq("id", orderId);
  if (error) return { error: error.message };
  revalidatePath("/dept/production");
  return {};
}

// ─── Machine allocation & run-order ───────────────────────────────────────────
//
// Two server actions drive the per-machine run-order board:
//
//   • assignProductionOrderToMachine — drag a card into a machine column. Sets
//     machine_id and mirrors the machine's name into the legacy `machine` text
//     column (for back-compat with the work-order page header / floor screens
//     that still read the text field). Optional `production_date` lets the
//     operator drop into a specific day column simultaneously.
//
//   • reorderMachineQueue — drag-to-reorder within a column. Overwrites
//     run_sequence for every order in the (machine_id, production_date) bucket
//     so the new order is canonical. We pass the full ordered list rather than
//     individual swaps because it's simpler, handles drag-from-elsewhere
//     cleanly, and the bucket is always small (a few orders per machine/day).

export async function assignProductionOrderToMachine(
  orderId: string,
  machineId: string | null,
  productionDate?: string | null,
): Promise<{ error?: string }> {
  const supabase = await createClient();

  // Planning-only gate: published orders are committed to the floor —
  // operators are looking at them. Run-order changes on a published order
  // would shuffle the floor's view from under them. Force the planner to
  // unpublish first (work-order page → ✕ Unpublish, or per-dept Unpublish on
  // the plan editor), which is the same convention setProductionOrderDate
  // and setOrderBatchSizing already use. Status check covers the case where
  // production has already started — same hands-off rule.
  const { data: existing } = await supabase
    .from("production_orders")
    .select("status, published_at")
    .eq("id", orderId)
    .single();
  if (!existing) return { error: "Order not found." };
  if (existing.status !== "planned") {
    return { error: `Order is ${existing.status}. Run-order changes are blocked once production has started.` };
  }
  if (existing.published_at) {
    return { error: "Order is published to the floor. Unpublish it first before reassigning machines." };
  }

  // Look up the machine + its capacity so we can (a) mirror name into the
  // legacy text column and (b) auto-recompute batch sizing when the new
  // machine has a different capacity than what the order was using.
  // (Tino, 2026-05-10: "if I move the WO to a different machine the batch
  // size may change.")
  let machineName: string | null = null;
  let machineCapacity: number | null = null;
  if (machineId) {
    const { data: m } = await supabase
      .from("machines")
      .select("name, capacity_value")
      .eq("id", machineId)
      .single();
    machineName = m?.name ?? null;
    machineCapacity = m?.capacity_value != null ? Number(m.capacity_value) : null;
  }

  // Build the patch. Only touch production_date when caller passed it — the
  // run-order board passes it on cross-day drops, but a same-day reassign
  // shouldn't disturb the existing date.
  const patch: Record<string, unknown> = {
    machine_id: machineId,
    machine: machineName,
  };
  if (productionDate !== undefined) patch.production_date = productionDate;

  // When a card moves to a new machine/day bucket its old run_sequence is
  // meaningless — null it. The follow-up reorderMachineQueue call will set
  // the correct sequence in the new bucket.
  patch.run_sequence = null;

  // Auto-recompute batch sizing if the new machine has a capacity. Splits
  // planned_qty into N batches at that capacity. If the new machine has no
  // capacity we leave existing batch sizing alone — operator may have set it
  // manually and shouldn't be silently overridden.
  if (machineCapacity != null && machineCapacity > 0) {
    const { data: planRow } = await supabase
      .from("production_orders")
      .select("planned_qty")
      .eq("id", orderId)
      .single();
    const planned = Number(planRow?.planned_qty) || 0;
    if (planned > 0) {
      const nBatches  = Math.max(1, Math.ceil(planned / machineCapacity));
      const batchSize = planned / nBatches;
      patch.target_batch_size = machineCapacity;
      patch.n_of_batches      = nBatches;
      patch.batch_size        = batchSize;
    }
  }

  const { error } = await supabase
    .from("production_orders")
    .update(patch)
    .eq("id", orderId);
  if (error) return { error: error.message };
  revalidatePath("/dept", "layout");
  return {};
}

export async function reorderMachineQueue(
  orderedIds: string[],
): Promise<{ error?: string }> {
  if (orderedIds.length === 0) return {};
  const supabase = await createClient();

  // Planning-only gate: any published or non-planned order in the list
  // means a planner is trying to reshuffle the floor's view. Refuse the
  // whole batch — partial-success would leave the bucket half-renumbered.
  // Same logic as assignProductionOrderToMachine.
  const { data: locked, error: lockErr } = await supabase
    .from("production_orders")
    .select("id, status, published_at")
    .in("id", orderedIds);
  if (lockErr) return { error: lockErr.message };
  const blocker = (locked ?? []).find(o => o.status !== "planned" || o.published_at);
  if (blocker) {
    if (blocker.status !== "planned") {
      return { error: `One of the orders is ${blocker.status}. Run-order changes are blocked once production has started.` };
    }
    return { error: "One or more orders are published to the floor. Unpublish them first before reordering." };
  }

  // Parallel N-update strategy. PostgREST doesn't accept CASE expressions on
  // its update endpoint, so the cleanest cross-version approach is to fire
  // one update per row in parallel. Bucket sizes are small (< 20 orders per
  // machine/day in practice), well inside a Vercel serverless budget.
  //
  // run_sequence is 1-indexed so the printable run sheet reads naturally
  // ("position 1, 2, 3...").
  const results = await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("production_orders").update({ run_sequence: i + 1 }).eq("id", id)
    )
  );
  const firstErr = results.find((r) => r.error)?.error;
  if (firstErr) return { error: firstErr.message };
  revalidatePath("/dept", "layout");
  return {};
}

// ─── Production-order consumption (per BOM line traceability) ────────────────
// One BOM line → many lots used. Operator records each (batch_number, qty)
// pair on the work-order page. We replace the entire set for a given
// (order, component) pair on save so the UI stays simple — render-edit-save
// without manual diffing — but the underlying audit trail still shows every
// historical row via recorded_at if you enable point-in-time recovery.

export type ConsumptionLot = {
  batch_number: string;
  qty_used: number;
  unit: string;
};

export async function saveOrderConsumption(
  productionOrderId: string,
  componentItemId: string,
  lots: ConsumptionLot[],
  notes: string | null
): Promise<{ error?: string; saved?: number }> {
  const supabase = await createClient();

  // Reject the save when the parent order has been QA-locked. The DB-level
  // RLS would refuse anyway, but a friendly app-level error reads better
  // than a Postgres permissions message in the UI.
  const { data: parent } = await supabase
    .from("production_orders")
    .select("traceability_locked_at")
    .eq("id", productionOrderId)
    .single();
  if (parent?.traceability_locked_at) {
    return { error: "Traceability is locked for this order. Ask an admin to unlock it before editing." };
  }

  // Drop the existing rows for this (order × component) so the new set
  // takes their place. This keeps the UI loop dead-simple — operator edits
  // a list, hits save, server replaces the whole list.
  const { error: delErr } = await supabase
    .from("production_order_consumption")
    .delete()
    .eq("production_order_id", productionOrderId)
    .eq("component_item_id", componentItemId);
  if (delErr) return { error: delErr.message };

  // Empty submission = caller wanted to wipe the consumption record.
  const cleaned = lots.filter(l => l.batch_number.trim() && l.qty_used > 0);
  if (cleaned.length === 0) {
    revalidatePath(`/work-orders/${productionOrderId}`);
    return { saved: 0 };
  }

  const rows = cleaned.map(l => ({
    production_order_id: productionOrderId,
    component_item_id: componentItemId,
    batch_number: l.batch_number.trim(),
    qty_used: Number(l.qty_used),
    unit: l.unit,
    notes,
  }));
  const { error: insErr } = await supabase
    .from("production_order_consumption")
    .insert(rows);
  if (insErr) return { error: insErr.message };

  revalidatePath(`/work-orders/${productionOrderId}`);
  return { saved: rows.length };
}

// ─── QA lock / unlock — admin (and later QA) only ───────────────────────────
//
// Lock semantics:
//   • Once locked, traceability_locked_at + traceability_locked_by are stamped.
//   • RLS blocks edits to the consumption rows from non-admins. Migration 080
//     also installs a trigger that blocks non-admins from touching the lock
//     columns themselves, so even direct DB access is guarded.
//   • Locking captures (or refreshes) the BOM snapshot — bom_header_id_used
//     stays whatever was set at Generate time, but we surface the snapshot
//     details on the work-order page so the regulatory record is obvious.
//
// We don't enforce the role here in the action layer: RLS does it at the row
// level. The action just runs the update and surfaces a friendly error if the
// trigger raised.

export async function lockOrderTraceability(
  productionOrderId: string
): Promise<{ error?: string; lockedAt?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const lockedAt = new Date().toISOString();
  const { error } = await supabase
    .from("production_orders")
    .update({
      traceability_locked_at: lockedAt,
      traceability_locked_by: user.id,
    })
    .eq("id", productionOrderId);
  if (error) {
    // Trigger will throw "Only admins (or QA) can lock or unlock…" for
    // non-admin attempts; surface that as-is so the UI can render it.
    return { error: error.message };
  }
  revalidatePath(`/work-orders/${productionOrderId}`);
  return { lockedAt };
}

export async function unlockOrderTraceability(
  productionOrderId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("production_orders")
    .update({
      traceability_locked_at: null,
      traceability_locked_by: null,
    })
    .eq("id", productionOrderId);
  if (error) return { error: error.message };
  revalidatePath(`/work-orders/${productionOrderId}`);
  return {};
}

// ─── Floor-side production override ─────────────────────────────────────────
//
// The plan stays put — planned_qty / batch_size / n_of_batches are the
// planner's record. When the floor needs to deviate (yield came in different,
// missing kit, opportunistic capacity, etc), this action stamps the actual
// values so both numbers are preserved for variance reporting.
//
// Pass nulls to clear the override and revert to planned.

export async function setActualProduction(
  productionOrderId: string,
  actualNOfBatches: number | null,
  actualBatchSize: number | null
): Promise<{ error?: string; actualQty?: number | null }> {
  const supabase = await createClient();

  // Block override on locked records — same gate as consumption editing.
  const { data: parent } = await supabase
    .from("production_orders")
    .select("traceability_locked_at")
    .eq("id", productionOrderId)
    .single();
  if (parent?.traceability_locked_at) {
    return { error: "Traceability is locked. Ask an admin to unlock before changing actuals." };
  }

  // Both nulls = clear the override entirely.
  if (actualNOfBatches == null && actualBatchSize == null) {
    const { error } = await supabase
      .from("production_orders")
      .update({
        actual_n_of_batches: null,
        actual_batch_size: null,
        actual_qty: null,
      })
      .eq("id", productionOrderId);
    if (error) return { error: error.message };
    revalidatePath(`/work-orders/${productionOrderId}`);
    return { actualQty: null };
  }

  // Otherwise both must be present + positive. Compute actual_qty.
  if (actualNOfBatches == null || actualBatchSize == null
      || actualNOfBatches <= 0 || actualBatchSize <= 0) {
    return { error: "Both number of batches and batch size must be positive numbers, or both empty." };
  }
  const actualQty = Number(actualNOfBatches) * Number(actualBatchSize);
  const { error } = await supabase
    .from("production_orders")
    .update({
      actual_n_of_batches: Math.round(actualNOfBatches),
      actual_batch_size: actualBatchSize,
      actual_qty: actualQty,
    })
    .eq("id", productionOrderId);
  if (error) return { error: error.message };
  revalidatePath(`/work-orders/${productionOrderId}`);
  return { actualQty };
}

// ─── Filling ──────────────────────────────────────────────────────────────────

export async function updateFillingOrder(
  orderId: string,
  fields: {
    status?: string;
    kg_produced?: number | null;
    n_links_produced?: number | null;
    fill_date?: string | null;
    notes?: string | null;
  }
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("filling_orders")
    .update(fields)
    .eq("id", orderId);
  if (error) return { error: error.message };
  revalidatePath("/dept/filling");
  return {};
}

// ─── Cooking ──────────────────────────────────────────────────────────────────

export async function updateCookingOrder(
  orderId: string,
  fields: {
    status?: string;
    raw_weight_in_kg?: number | null;
    cooked_weight_out_kg?: number | null;
    yield_pct?: number | null;
    core_temp_achieved_c?: number | null;
    cook_program?: string | null;
    oven_id?: string | null;
    cook_start_time?: string | null;
    cook_end_time?: string | null;
    cook_date?: string | null;
    notes?: string | null;
  }
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("cooking_orders")
    .update(fields)
    .eq("id", orderId);
  if (error) return { error: error.message };
  revalidatePath("/dept/cooking");
  return {};
}

// ─── Packing ──────────────────────────────────────────────────────────────────

export async function updatePackingOrder(
  orderId: string,
  fields: {
    status?: string;
    packed_units?: number | null;
    wastage_units?: number | null;
    total_giveaway_g?: number | null;
    avg_giveaway_g?: number | null;
    packed_weight_kg?: number | null;
    wastage_weight_kg?: number | null;
    pack_date?: string | null;
    notes?: string | null;
  }
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("packing_orders")
    .update(fields)
    .eq("id", orderId);
  if (error) return { error: error.message };
  revalidatePath("/dept/packing");
  return {};
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export async function createDispatchRecord(data: {
  dispatch_date: string;
  item_id: string;
  qty_units?: number | null;
  qty_kg?: number | null;
  customer_name?: string | null;
  customer_ref?: string | null;
  demand_line_id?: string | null;
  notes?: string | null;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("dispatch_records").insert(data);
  if (error) return { error: error.message };
  revalidatePath("/dept/dispatch");
  return {};
}
