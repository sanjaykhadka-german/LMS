"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type DemandLineInput = {
  id?: string;
  item_id: string;
  demand_type: string;
  planned_qty_kg?: number | null;
  planned_units?: number | null;
  customer_ref?: string | null;
  customer_name?: string | null;
  required_date?: string | null;
  day_of_week?: number | null;
  priority?: number;
  notes?: string | null;
};

/**
 * Saves (upserts) all demand lines for a plan.
 *
 * Returns `insertedIds` — the IDs of the newly-inserted rows, in the SAME
 * order as the new (unsaved) rows passed in. The client uses this to merge
 * the IDs back onto its local state, otherwise the next save would re-INSERT
 * the same lines (root cause of duplicate-line bug seen May 2026).
 */
export async function saveDemandLines(
  planId: string,
  lines: DemandLineInput[],
  deletedIds: string[]
): Promise<{ error?: string; insertedIds?: string[] }> {
  const supabase = await createClient();

  // Delete removed lines
  if (deletedIds.length > 0) {
    const { error } = await supabase
      .from("demand_lines")
      .delete()
      .in("id", deletedIds);
    if (error) return { error: error.message };
  }

  let insertedIds: string[] = [];

  // Save current lines.
  //
  // Why split: Supabase upsert in a single call fills missing keys with null
  // across the batch. So if rows are mixed (some have `id`, some don't), the
  // new rows get id=null sent to PG, which violates the PK NOT NULL.
  // Splitting lets each call be homogeneous: INSERT brand-new rows (let the
  // DB default the uuid), UPDATE existing rows by id.
  if (lines.length > 0) {
    const baseRow = (l: DemandLineInput) => ({
      demand_plan_id: planId,
      item_id: l.item_id,
      demand_type: l.demand_type,
      planned_qty_kg: l.planned_qty_kg ?? null,
      planned_units: l.planned_units ?? null,
      customer_ref: l.customer_ref ?? null,
      customer_name: l.customer_name ?? null,
      required_date: l.required_date ?? null,
      day_of_week: l.day_of_week ?? null,
      priority: l.priority ?? 5,
      notes: l.notes ?? null,
    });

    const newRows = lines.filter(l => !l.id).map(baseRow);
    const existingRows = lines.filter(l => l.id);

    if (newRows.length > 0) {
      // .select() echoes the inserted rows (with generated UUIDs) back so we
      // can hand them to the client. Order is preserved.
      const { data: inserted, error } = await supabase
        .from("demand_lines")
        .insert(newRows)
        .select("id");
      if (error) return { error: error.message };
      insertedIds = (inserted ?? []).map(r => r.id);
    }

    for (const l of existingRows) {
      const { error } = await supabase
        .from("demand_lines")
        .update(baseRow(l))
        .eq("id", l.id!);
      if (error) return { error: error.message };
    }
  }

  revalidatePath(`/plans/${planId}`);
  return { insertedIds };
}

/**
 * Runs the MRP explosion for a given demand plan.
 * Calls the explode_mrp(p_demand_plan_id) PostgreSQL function.
 */
export async function runMrp(planId: string): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("explode_mrp", {
    p_demand_plan_id: planId,
  });

  if (error) return { error: error.message };

  revalidatePath(`/plans/${planId}`);
  return {};
}

/**
 * MRP overrides — emergency release valve for typo / bad-BOM corrections.
 *
 *   saveOverride   — upsert an override on (plan, item, dept) and re-explode
 *                    so the cascade picks up the new value immediately.
 *   clearOverride  — mark an override resolved (with optional note) and
 *                    re-explode. The audit trail is preserved.
 *
 * See: migration 117_mrp_overrides_and_explode_v2.sql + override-modal.tsx.
 */
export async function saveOverride(input: {
  plan_id: string;
  item_id: string;
  department: string;
  override_qty: number;
  reason: string;
}): Promise<{ ok: true; id: string } | { error: string }> {
  if (!input.reason || input.reason.trim().length < 3) {
    return { error: "Reason is required (min 3 chars)" };
  }
  if (input.override_qty < 0) return { error: "Override qty must be ≥ 0" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: existing } = await supabase
    .from("mrp_overrides")
    .select("id")
    .eq("demand_plan_id", input.plan_id)
    .eq("item_id", input.item_id)
    .eq("department", input.department)
    .maybeSingle();

  let savedId: string | undefined;
  if (existing) {
    const { error } = await supabase
      .from("mrp_overrides")
      .update({
        override_qty:  input.override_qty,
        reason:        input.reason.trim(),
        overridden_by: user?.id ?? null,
        overridden_at: new Date().toISOString(),
        resolved_at:   null,
        resolved_by:   null,
        resolved_note: null,
      })
      .eq("id", existing.id);
    if (error) return { error: error.message };
    savedId = existing.id;
  } else {
    const { data, error } = await supabase
      .from("mrp_overrides")
      .insert({
        demand_plan_id: input.plan_id,
        item_id:        input.item_id,
        department:     input.department,
        override_qty:   input.override_qty,
        reason:         input.reason.trim(),
        overridden_by:  user?.id ?? null,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    savedId = data.id;
  }

  await supabase.rpc("explode_mrp", { p_demand_plan_id: input.plan_id });

  // Sync production_orders.planned_qty so the work order cards in the dept
  // scheduler reflect the override immediately. We match on (plan, item) —
  // production_orders.department may use lowercase aliases ("wip" vs the
  // override's "Production"), so keying off item_id is the safer bet.
  const { data: orders } = await supabase
    .from("production_orders")
    .select("id, n_of_batches")
    .eq("demand_plan_id", input.plan_id)
    .eq("item_id", input.item_id);
  for (const o of (orders ?? []) as Array<{ id: string; n_of_batches: number | null }>) {
    const nBatches = o.n_of_batches ?? 1;
    const newBatchSize = nBatches > 0 ? input.override_qty / nBatches : input.override_qty;
    await supabase
      .from("production_orders")
      .update({
        planned_qty: input.override_qty,
        batch_size:  newBatchSize,
      })
      .eq("id", o.id);
  }

  revalidatePath(`/plans/${input.plan_id}`);
  revalidatePath("/overrides");
  return { ok: true, id: savedId! };
}

export async function clearOverride(input: {
  override_id: string;
  resolved_note?: string;
}): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: row, error: e1 } = await supabase
    .from("mrp_overrides")
    .select("demand_plan_id")
    .eq("id", input.override_id)
    .single();
  if (e1) return { error: e1.message };

  const { error } = await supabase
    .from("mrp_overrides")
    .update({
      resolved_at:   new Date().toISOString(),
      resolved_by:   user?.id ?? null,
      resolved_note: input.resolved_note ?? null,
    })
    .eq("id", input.override_id);
  if (error) return { error: error.message };

  await supabase.rpc("explode_mrp", { p_demand_plan_id: row.demand_plan_id });

  // Re-sync production_orders back to the cascade-derived qty (no override).
  const { data: cleared } = await supabase
    .from("mrp_overrides")
    .select("item_id")
    .eq("id", input.override_id)
    .single();
  if (cleared) {
    const { data: mrp } = await supabase
      .from("mrp_results")
      .select("required_qty")
      .eq("demand_plan_id", row.demand_plan_id)
      .eq("item_id", cleared.item_id)
      .maybeSingle();
    if (mrp) {
      const newQty = Number(mrp.required_qty);
      const { data: orders } = await supabase
        .from("production_orders")
        .select("id, n_of_batches")
        .eq("demand_plan_id", row.demand_plan_id)
        .eq("item_id", cleared.item_id);
      for (const o of (orders ?? []) as Array<{ id: string; n_of_batches: number | null }>) {
        const nBatches = o.n_of_batches ?? 1;
        await supabase
          .from("production_orders")
          .update({
            planned_qty: newQty,
            batch_size:  nBatches > 0 ? newQty / nBatches : newQty,
          })
          .eq("id", o.id);
      }
    }
  }

  revalidatePath(`/plans/${row.demand_plan_id}`);
  revalidatePath("/overrides");
  return { ok: true };
}

/**
 * Split a production_order into N orders so the qty can be made across
 * multiple days. Each split inherits the original's item / dept / plan and
 * gets its own production_date + qty + batch_number suffix.
 *
 * Materials cascade automatically — the per-date materials RPC keys off
 * production_orders, so each split's date informs JIT material requirements.
 *
 * Validation:
 *  - Must be at least 2 splits
 *  - All qtys must be > 0
 *  - Sum of split qtys must match the original (with a soft warning if not)
 */
export async function splitProductionOrder(
  orderId: string,
  splits: Array<{ qty: number; production_date: string | null }>
): Promise<{ ok: true; created_ids: string[] } | { error: string }> {
  if (!Array.isArray(splits) || splits.length < 2) {
    return { error: "At least 2 splits required" };
  }
  for (const s of splits) {
    if (!Number.isFinite(s.qty) || s.qty <= 0) return { error: "Each split qty must be > 0" };
  }

  const supabase = await createClient();

  // Fetch the original
  const { data: orig, error: e1 } = await supabase
    .from("production_orders")
    .select("id, demand_plan_id, item_id, department, batch_number, planned_qty, unit, priority, status, published_at, target_batch_size")
    .eq("id", orderId)
    .single();
  if (e1) return { error: e1.message };
  if (!orig) return { error: "Order not found" };
  if (orig.published_at) return { error: "Cannot split a published order — unpublish first" };
  if (orig.status !== "planned") return { error: `Cannot split a ${orig.status} order` };

  // Build new rows. batch_number gets ".1" / ".2" / ".3" suffixes.
  const newRows = splits.map((s, idx) => ({
    demand_plan_id:    orig.demand_plan_id,
    item_id:           orig.item_id,
    department:        orig.department,
    batch_number:      `${orig.batch_number}.${idx + 1}`,
    planned_qty:       s.qty,
    unit:              orig.unit,
    priority:          orig.priority,
    status:            "planned",
    production_date:   s.production_date,
    n_of_batches:      1,
    batch_size:        s.qty,
    target_batch_size: orig.target_batch_size ?? null,
  }));

  // Cancel the original (NOT delete) — production_orders has no DELETE
  // RLS policy so DELETE silently fails (0 rows affected, no error). UPDATE
  // status='cancelled' achieves the same end result and preserves the audit
  // trail. The materials RPC + dept scheduler both filter status<>'cancelled'
  // so cancelled orders disappear from the UI.
  const { error: dErr } = await supabase
    .from("production_orders")
    .update({ status: "cancelled" })
    .eq("id", orderId);
  if (dErr) return { error: dErr.message };

  const { data: ins, error: iErr } = await supabase
    .from("production_orders")
    .insert(newRows)
    .select("id");
  if (iErr) return { error: iErr.message };

  revalidatePath(`/plans/${orig.demand_plan_id}`);
  return { ok: true, created_ids: (ins ?? []).map(r => r.id) };
}

/**
 * Updates the demand plan status.
 */
export async function updatePlanStatus(
  planId: string,
  status: string
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("demand_plans")
    .update({ status })
    .eq("id", planId);

  if (error) return { error: error.message };

  revalidatePath(`/plans/${planId}`);
  return {};
}

/**
 * Deletes a demand plan — but only if it's still a draft (i.e. nothing has
 * been generated/locked yet). The DB-side RLS policy added in migration 069
 * enforces this at the row level (status='draft' check); the WHERE clause
 * here is a belt-and-braces second check.
 *
 * demand_lines and mrp_results have ON DELETE CASCADE foreign keys, so they
 * tear down with the plan. production_orders shouldn't exist for a draft
 * plan (they're only created on Generate & Lock), but if any do, the FK
 * without cascade will block the delete and the user will see the message.
 */
export async function deleteDraftPlan(planId: string): Promise<{ error?: string }> {
  const supabase = await createClient();

  // Double-check status before issuing the delete so we can return a friendly
  // error rather than a silent zero-row-deleted result if RLS rejects.
  const { data: plan, error: fetchErr } = await supabase
    .from("demand_plans")
    .select("status")
    .eq("id", planId)
    .single();
  if (fetchErr) return { error: fetchErr.message };
  if (!plan) return { error: "Plan not found" };
  if (plan.status !== "draft") {
    return { error: `Cannot delete a plan with status '${plan.status}'. Only draft plans can be deleted.` };
  }

  // Cascade-delete dependents in FK order so the demand_plans delete doesn't
  // trip "production_orders_demand_plan_id_fkey". Draft plans have no floor
  // commitment (production_orders.published_at IS NULL by definition for
  // drafts), so this is safe — nothing operators are looking at.
  //
  // Order matters: production_orders & mrp_results both reference the plan,
  // demand_lines references the plan. Delete children first, then the plan.
  const cleanups: { table: string; res: { error: { message: string } | null } }[] = [];
  cleanups.push({ table: "production_orders", res: await supabase.from("production_orders").delete().eq("demand_plan_id", planId) });
  cleanups.push({ table: "mrp_results",       res: await supabase.from("mrp_results").delete().eq("demand_plan_id", planId) });
  cleanups.push({ table: "demand_lines",      res: await supabase.from("demand_lines").delete().eq("demand_plan_id", planId) });
  for (const c of cleanups) {
    if (c.res.error) return { error: `Failed cleaning ${c.table}: ${c.res.error.message}` };
  }

  const { error } = await supabase
    .from("demand_plans")
    .delete()
    .eq("id", planId)
    .eq("status", "draft"); // belt-and-braces

  if (error) return { error: error.message };

  revalidatePath("/plans");
  return {};
}

/**
 * Sets the scheduled production date on a single MRP result row.
 * Called by the date-allocation grid in each dept modal.
 * Pass `date = null` to un-schedule (move back to "Unscheduled" column).
 */
export async function scheduleMrpItem(
  mrpResultId: string,
  date: string | null
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("mrp_results")
    .update({ scheduled_date: date })
    .eq("id", mrpResultId);
  if (error) return { error: error.message };
  return {};
}

/**
 * Re-opens a locked plan so the operator can edit demand / re-run MRP /
 * re-generate orders. Stamps reopened_at for audit. Status flips to draft.
 *
 * Reconciliation of related data happens on the NEXT run of generateProductionOrders
 * (which is idempotent and updates / cancels rows as MRP changes).
 */
export async function reopenPlan(planId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("demand_plans")
    .update({ status: "draft", reopened_at: new Date().toISOString() })
    .eq("id", planId);
  if (error) return { error: error.message };
  revalidatePath(`/plans/${planId}`);
  return {};
}

/**
 * Generates production orders from MRP results — idempotent and per-department capable.
 *
 * Coverage: every produced item (procurement_type = 'produce' OR item_types.is_producible).
 *           Hardcoded ["wip","fill"] is GONE — any new producible type is included.
 *
 * Idempotency: matches existing production_orders by (demand_plan_id, item_id) and
 *           UPDATES the row (qty, batches, date) instead of inserting a duplicate.
 *           Orders past 'planned' status are NOT modified (operator already started).
 *           Items removed from MRP get their planned orders cancelled (status = 'cancelled').
 *
 * Per-department: pass `deptFilter` to only sync orders for items belonging to a
 *           single department; pass `null` to sync everything in the plan.
 *
 * Date: each order's production_date comes from mrp_results.scheduled_date.
 *           If unallocated → defaults to plan.week_start (Monday) and the row is
 *           returned in `unscheduledItems` so the UI can warn.
 */
export async function generateProductionOrders(
  planId: string,
  opts?: { deptFilter?: string | null; deptCodes?: string[] }
): Promise<{
  error?: string;
  created?: number;
  updated?: number;
  cancelled?: number;
  unscheduled?: number;
  touchedDepts?: string[];
  /** Phase 2G (Tino May 2026): producible items that hit Save & Build with no
   *  active BOM. Without a BOM, the explosion has nothing to break down — we
   *  still create the FG work order, but its component requirements stay
   *  empty and downstream WIP/RM stages won't be planned. Surface to the
   *  planner so they can fix the BOM before publishing. */
  missingBomItems?: { code: string; name: string; itemType: string }[];
  /** Items whose parent_item_id points to a row that's deactivated or
   *  doesn't exist — the family-batch traceability walk would silently
   *  drop them, so the operator should know. */
  orphanParentItems?: { code: string; name: string }[];
}> {
  const supabase = await createClient();
  const deptFilter = opts?.deptFilter ?? null;
  // Optional list of department-name aliases the caller wants treated as the
  // same dept (e.g. ["Production", "PROD", "production", "wip"]). When set,
  // any mrp_results.department matching ANY of these (case-insensitive) is
  // considered part of this dept. Lets per-dept Generate catch items whose
  // explode_mrp dept fell back to item_type ("wip").
  const deptCodesLower = (opts?.deptCodes ?? []).map(c => c.toLowerCase());

  const { data: plan } = await supabase
    .from("demand_plans")
    .select("week_start, tenant_id, status")
    .eq("id", planId)
    .single();
  if (!plan) return { error: "Plan not found" };

  // Pull all producible item types (drives off the item_types register).
  const { data: producibleTypes } = await supabase
    .from("item_types")
    .select("code")
    .eq("is_producible", true)
    .eq("is_active", true);
  const producibleSet = new Set((producibleTypes ?? []).map(t => t.code));

  // Pull MRP results with item context + existing production_order matches.
  const { data: results, error: fetchErr } = await supabase
    .from("mrp_results")
    .select(`
      id, item_id, department, scheduled_date, net_required_qty,
      planned_qty, rounded_batches, standard_batch_size, unit,
      item:item_id(id, code, name, item_type, department, procurement_type, default_batch_size, batch_unit)
    `)
    .eq("demand_plan_id", planId);
  if (fetchErr) return { error: fetchErr.message };
  if (!results || results.length === 0) return { created: 0, updated: 0, cancelled: 0, unscheduled: 0, touchedDepts: [] };

  // Filter to producible items only (skip raw materials, packaging, etc.)
  const producibleRows = results.filter(r => {
    const it = r.item as { item_type: string; procurement_type: string | null } | null;
    if (!it) return false;
    if (it.procurement_type === "produce") return true;
    return producibleSet.has(it.item_type);
  });

  // Optional dept filter — match against deptCodes alias list when provided
  // (e.g. Production also catches "wip"); fall back to single-name match.
  const targetRows = deptFilter
    ? producibleRows.filter(r => {
        const rDept = (r.department ?? "").toLowerCase();
        if (deptCodesLower.length > 0) return deptCodesLower.includes(rDept);
        return rDept === deptFilter.toLowerCase();
      })
    : producibleRows;

  // Skip rows with no net work to do
  const workingRows = targetRows.filter(r => (r.net_required_qty ?? 0) > 0);

  // Snapshot the active BOM per producible item so each generated order can
  // record WHICH RECIPE VERSION was used. Migration 080 — when a recipe is
  // updated later, historical traceability rows still point to the version
  // that was actually run on the floor.
  const workingItemIdsForBom = [...new Set(workingRows.map(r => r.item_id))];
  const { data: activeBoms } = workingItemIdsForBom.length > 0
    ? await supabase
        .from("bom_headers")
        .select("id, item_id, version")
        .eq("is_active", true)
        .in("item_id", workingItemIdsForBom)
        .order("version", { ascending: false })
    : { data: [] as { id: string; item_id: string; version: number }[] };
  const bomByItem = new Map<string, { id: string; version: number }>();
  for (const b of (activeBoms ?? [])) {
    if (!bomByItem.has(b.item_id)) {
      bomByItem.set(b.item_id, { id: b.id, version: b.version });
    }
  }

  // Phase 2G: collect items that landed in workingRows without an active
  // BOM. We can still create the FG order (the planner might be intentionally
  // making a one-off without a recipe), but we surface the list as a warning
  // so the most common case — "I forgot to activate the BOM" — gets caught
  // before the dept board fills up with incomplete plans.
  const missingBomItems: { code: string; name: string; itemType: string }[] = [];
  for (const r of workingRows) {
    const it = r.item as unknown as { code: string; name?: string | null; item_type: string } | null;
    if (!it) continue;
    if (bomByItem.has(r.item_id)) continue;
    missingBomItems.push({
      code: it.code,
      name: it.name ?? it.code,
      itemType: it.item_type,
    });
  }

  // Orphan parent-chain detector — pull parent_item_id for the producible
  // items in this batch and check that every parent resolves to an active
  // item row. Family-batch traceability (mig 082) walks this chain to derive
  // the YY+DDD+root_code stamp; a broken link means the family-mate grouping
  // silently drops affected rows, so the planner needs to know.
  const orphanParentItems: { code: string; name: string }[] = [];
  if (workingItemIdsForBom.length > 0) {
    const { data: itemsWithParents } = await supabase
      .from("items")
      .select("id, code, name, parent_item_id")
      .in("id", workingItemIdsForBom);
    const parentIds = [...new Set(
      (itemsWithParents ?? []).map(x => x.parent_item_id).filter((p): p is string => !!p)
    )];
    if (parentIds.length > 0) {
      const { data: parentRows } = await supabase
        .from("items")
        .select("id, is_active")
        .in("id", parentIds);
      const validParents = new Set(
        (parentRows ?? [])
          .filter(p => (p as { is_active?: boolean }).is_active !== false)
          .map(p => (p as { id: string }).id)
      );
      for (const it of (itemsWithParents ?? [])) {
        const pid = (it as { parent_item_id?: string | null }).parent_item_id;
        if (pid && !validParents.has(pid)) {
          orphanParentItems.push({
            code: (it as { code: string }).code,
            name: (it as { name?: string | null }).name ?? (it as { code: string }).code,
          });
        }
      }
    }
  }

  // Pull every existing non-cancelled production_order for this plan so we
  // can update vs insert. We deliberately DO NOT filter by department even
  // when deptFilter is set — the dedup key is (plan, item). When an item's
  // mrp_results.department drifts (e.g. items.department was null and the
  // fallback chain landed on item_type "wip", then the operator clicked
  // Generate inside the Production modal with deptFilter="production"), a
  // dept-scoped fetch would miss the existing wip-tagged order and the loop
  // would create a duplicate. Migration 084 also installs a partial unique
  // index as defense-in-depth at the DB level.
  //
  // Pull production_date / day_of_week / target_batch_size / n_of_batches /
  // batch_size as well so we can PRESERVE operator-set values on a re-run of
  // Generate. Without that, dragging an order onto Wednesday and then
  // re-running Generate would silently wipe the date and batch sizing back
  // to defaults.
  const { data: existingOrders } = await supabase
    .from("production_orders")
    .select("id, item_id, status, department, traceability_locked_at, production_date, day_of_week, target_batch_size, n_of_batches, batch_size")
    .eq("demand_plan_id", planId)
    .neq("status", "cancelled");
  type ExistingOrder = {
    id: string; status: string; department: string;
    traceability_locked_at: string | null;
    production_date: string | null;
    day_of_week: number | null;
    target_batch_size: number | null;
    n_of_batches: number | null;
    batch_size: number | null;
  };
  const existingByItemId = new Map<string, ExistingOrder>(
    (existingOrders ?? []).map(o => [o.item_id, o as ExistingOrder])
  );

  // Machine pre-fill (Tino, 2026-05-10):
  //   • items.machine is a free-text field that may match a machines.name
  //     OR machines.code. If we find a match we pre-fill production_orders
  //     .machine_id so the work order shows up under that machine when the
  //     planner opens "Schedule machines".
  //   • If the matched machine has capacity_value > 0, we use it as the
  //     batch-size cap so n_of_batches = ceil(planned_qty / capacity).
  //     Otherwise we fall back to items.default_batch_size, then to a
  //     single batch. Operator-set target_batch_size always wins (preserved
  //     in the existing-row branch above).
  const { data: machines } = await supabase
    .from("machines")
    .select("id, name, code, capacity_value")
    .eq("tenant_id", plan.tenant_id)
    .eq("is_active", true);
  type MachineRow = { id: string; name: string | null; code: string | null; capacity_value: number | null };
  const machineByKey = new Map<string, MachineRow>();
  for (const m of (machines ?? []) as MachineRow[]) {
    if (m.name) machineByKey.set(m.name.trim().toLowerCase(), m);
    if (m.code) machineByKey.set(m.code.trim().toLowerCase(), m);
  }
  function lookupMachine(itemMachine: string | null | undefined): MachineRow | null {
    if (!itemMachine) return null;
    return machineByKey.get(itemMachine.trim().toLowerCase()) ?? null;
  }

  const now = new Date().toISOString();
  let created = 0, updated = 0, cancelled = 0, unscheduled = 0;
  const touchedDepts = new Set<string>();

  for (const r of workingRows) {
    const item = r.item as { id: string; code: string; item_type: string; department: string | null; procurement_type: string | null; default_batch_size: number | null; batch_unit: string | null };
    const dept = item.department ?? r.department ?? item.item_type;
    touchedDepts.add(dept);
    // Generate-time scheduling policy (Tino, May 2026):
    //   • If MRP knows a date (because the demand line had day_of_week or
    //     required_date set), use it.
    //   • Otherwise leave production_date NULL — the order lands in the
    //     "Unscheduled" column of the per-dept scheduler so the planner
    //     drags it onto the right day before publishing.
    //   Previous behaviour was "default to Monday" which silently put every
    //   undated order onto week_start and looked like garbage in the planner.
    const productionDate = r.scheduled_date ?? null;
    if (!r.scheduled_date) unscheduled++;
    // Keep day_of_week in sync — null when unscheduled, otherwise 0=Mon..6=Sun.
    let prodDayOfWeek: number | null = null;
    if (productionDate) {
      const d = new Date(productionDate + "T00:00:00Z");
      prodDayOfWeek = (d.getUTCDay() + 6) % 7;
    }

    const existing = existingByItemId.get(r.item_id);
    // Batch sizing (per Tino, May 2026):
    //   • target_batch_size = planner cap (defaults to items.default_batch_size)
    //   • n_of_batches      = ceil(planned_qty / target_batch_size)
    //   • batch_size        = planned_qty / n_of_batches  (split evenly)
    // When target is missing or invalid, we fall back to a single batch of
    // the full planned qty so the order is at least visible.
    // Auto-pick batch size from (machine capacity → item default → 1 batch).
    const itemMachineRow = lookupMachine((item as { machine?: string | null }).machine);
    const machineCap = Number(itemMachineRow?.capacity_value) || 0;
    const itemDefault = Number(item.default_batch_size) || 0;
    const autoTarget = machineCap > 0 ? machineCap
                       : itemDefault > 0 ? itemDefault
                       : Number(r.planned_qty);
    const targetBatch = autoTarget;
    const nBatches = targetBatch > 0
      ? Math.max(1, Math.ceil(Number(r.planned_qty) / targetBatch))
      : 1;
    const batchQty = Number(r.planned_qty) / nBatches;
    const bomSnap = bomByItem.get(item.id) ?? null;
    if (existing) {
      // Don't touch orders past 'planned' status — operator's already started.
      if (existing.status !== "planned") continue;
      // Don't touch locked traceability records either — even if the order
      // is still 'planned', a manual lock means hands-off.
      if (existing.traceability_locked_at) continue;
      // Preserve operator-set fields on re-run (May 2026 fix):
      //   • production_date / day_of_week — once the planner has dragged it
      //     onto a day, Generate must not pull it back to "Unscheduled".
      //   • target_batch_size + derived n_of_batches/batch_size — once the
      //     planner has set max batch size manually, Generate must not
      //     overwrite with items.default_batch_size.
      // We DO refresh planned_qty (MRP might have changed it) and the BOM
      // snapshot. If planned_qty changed, n_of_batches stays as the planner
      // set it but batch_size auto-rescales so n × batch_size = new planned.
      const keepDate    = existing.production_date != null;
      const keepBatchN  = existing.target_batch_size != null && (existing.n_of_batches ?? 0) > 0;
      const useNBatches = keepBatchN ? Number(existing.n_of_batches) : nBatches;
      const useBatchQty = useNBatches > 0 ? Number(r.planned_qty) / useNBatches : Number(r.planned_qty);
      const { error: updErr } = await supabase
        .from("production_orders")
        .update({
          department: dept,
          production_date: keepDate ? existing.production_date : productionDate,
          day_of_week: keepDate ? existing.day_of_week : prodDayOfWeek,
          target_batch_size: keepBatchN ? existing.target_batch_size : targetBatch,
          n_of_batches: useNBatches,
          batch_size: useBatchQty,
          planned_qty: r.planned_qty,
          unit: item.batch_unit ?? r.unit ?? "kg",
          // Refresh the BOM snapshot every Generate — until the operator
          // locks traceability, we want it to reflect the latest active
          // recipe so re-generates pick up recipe edits made by the planner.
          bom_header_id_used: bomSnap?.id ?? null,
          bom_version_used: bomSnap?.version ?? null,
          last_synced_at: now,
        })
        .eq("id", existing.id);
      if (!updErr) updated++;
    } else {
      // Build the batch number via the SQL function (migration 082). It walks
      // parent_item_id to find the first WIP-type ancestor and returns
      // YY+DDD+root_code — e.g. "261241024" for an item in family 1024
      // produced 4 May 2026. Family-mates produced on the same day SHARE a
      // batch number, which is the intended traceability behaviour. The
      // unique(tenant_id, batch_number) constraint was dropped in the same
      // migration to allow this. See migration 082 for the full rationale.
      //
      // We pass production_date when MRP knows one, otherwise fall back to
      // week_start (Monday). Re-Generate after drag-drop won't re-stamp
      // because the update branch (above) doesn't touch batch_number.
      const batchDate = productionDate ?? plan.week_start;
      const { data: batchNumberData } = await supabase
        .rpc("generate_batch_number", { p_item_id: item.id, p_date: batchDate });
      // Defensive fallback if the RPC returns nothing — the function always
      // returns a non-null string, but a missing migration would land here.
      const batchNumber = (typeof batchNumberData === "string" && batchNumberData.length > 0)
        ? batchNumberData
        : `${plan.week_start.replace(/-/g, "")}-${item.code}`;
      const { error: insErr } = await supabase
        .from("production_orders")
        .insert({
          tenant_id: plan.tenant_id,
          demand_plan_id: planId,
          item_id: item.id,
          department: dept,
          batch_number: batchNumber,
          production_date: productionDate,
          day_of_week: prodDayOfWeek,
          target_batch_size: targetBatch,
          n_of_batches: nBatches,
          batch_size: batchQty,
          unit: item.batch_unit ?? r.unit ?? "kg",
          planned_qty: r.planned_qty,
          status: "planned",
          // Pre-fill machine assignment so the work order lands under the
          // expected machine when the planner opens Schedule Machines.
          machine_id: itemMachineRow?.id ?? null,
          bom_header_id_used: bomSnap?.id ?? null,
          bom_version_used: bomSnap?.version ?? null,
          last_synced_at: now,
        });
      if (!insErr) created++;
    }
  }

  // Reconciliation: any existing 'planned' orders for items NOT in workingRows
  // (because demand changed / item now covered by SOH) → cancel.
  //
  // Important: when deptFilter is set we MUST NOT cancel orders belonging to
  // other departments. The existingOrders fetch above is plan-wide (so dedup
  // can find a misclassified existing order regardless of dept), but the
  // orphan loop has to scope itself by dept when running per-dept Generate —
  // otherwise running per-dept Generate for Production would wipe Filling &
  // Packing orders.
  const workingItemIds = new Set(workingRows.map(r => r.item_id));
  const orphanCandidates = (existingOrders ?? []).filter(o => {
    if (o.status !== "planned") return false;
    if (deptFilter) {
      const oDept = (o.department ?? "").toLowerCase();
      const matchesDept = deptCodesLower.length > 0
        ? deptCodesLower.includes(oDept)
        : oDept === deptFilter.toLowerCase();
      if (!matchesDept) return false;
    }
    return !workingItemIds.has(o.item_id);
  });
  if (orphanCandidates.length > 0) {
    const { error: cancelErr } = await supabase
      .from("production_orders")
      .update({ status: "cancelled", last_synced_at: now })
      .in("id", orphanCandidates.map(o => o.id));
    if (!cancelErr) cancelled = orphanCandidates.length;
  }

  // NOTE: this used to auto-lock the plan when run with no dept filter.
  // Locking is now a separate explicit action (lockAndPublishPlan below) so
  // operators can re-run Save & Build Work Orders multiple times while
  // iterating, then explicitly Lock & Publish once dates are settled.

  // ── Day-cascade at generate time (Tino May 2026) ─────────────────────
  // When a demand line had day_of_week set on it, that day flowed through
  // explode_mrp into mrp_results.scheduled_date and onto the FG order's
  // production_date above. But the FG's *upstream* orders (WIPP, WIPF,
  // WIP for Chorizo (R), say) come out dateless because explode_mrp only
  // dates the FG row.
  //
  // To save the planner three drags per chain, walk DOWN each dated FG
  // order's BOM tree (via get_bom_walk RPC) and copy the date onto every
  // upstream order in the same plan that's still empty + planned + not
  // yet finalised. Operator can refine afterwards.
  const { data: datedOrders } = await supabase
    .from("production_orders")
    .select("id, item_id, production_date, day_of_week")
    .eq("demand_plan_id", planId)
    .eq("status", "planned")
    .is("published_at", null)
    .not("production_date", "is", null);
  for (const dated of (datedOrders ?? [])) {
    const { data: walk } = await supabase.rpc("get_bom_walk", { p_item_id: dated.item_id });
    const items = (walk as { items?: { id: string }[] } | null)?.items ?? [];
    const treeItemIds = items.map(i => i.id).filter(id => id !== dated.item_id);
    if (treeItemIds.length === 0) continue;
    await supabase
      .from("production_orders")
      .update({ production_date: dated.production_date, day_of_week: dated.day_of_week })
      .eq("demand_plan_id", planId)
      .in("item_id", treeItemIds)
      .is("production_date", null)
      .eq("status", "planned")
      .is("published_at", null);
  }

  revalidatePath(`/plans/${planId}`);
  return {
    created,
    updated,
    cancelled,
    unscheduled,
    touchedDepts: [...touchedDepts],
    missingBomItems,
    orphanParentItems,
  };
}

/**
 * Planner-side batch sizing — set the max single-batch size on one order
 * and re-derive n_of_batches + batch_size accordingly. Independent per-order
 * (no dept-to-dept linkage) so each dept picks its own batching.
 *
 * Pass targetBatchSize = null to clear the cap and revert to a single batch.
 * Blocks edits on published orders so the floor doesn't see a moving target.
 */
export async function setOrderBatchSizing(
  orderId: string,
  targetBatchSize: number | null
): Promise<{ error?: string; nBatches?: number; batchSize?: number }> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("production_orders")
    .select("planned_qty, status, published_at")
    .eq("id", orderId)
    .single();
  if (!existing) return { error: "Order not found" };
  if (existing.published_at) {
    return { error: "Order is published. Unpublish the dept first to change batch sizing." };
  }
  if (existing.status !== "planned") {
    return { error: `Order is ${existing.status}, can't change batch sizing.` };
  }

  const planned = Number(existing.planned_qty) || 0;
  const target = targetBatchSize != null && targetBatchSize > 0 ? Number(targetBatchSize) : null;
  const nBatches = target && planned > 0
    ? Math.max(1, Math.ceil(planned / target))
    : 1;
  const batchSize = nBatches > 0 ? planned / nBatches : planned;

  const { error } = await supabase
    .from("production_orders")
    .update({
      target_batch_size: target,
      n_of_batches: nBatches,
      batch_size: batchSize,
    })
    .eq("id", orderId);
  if (error) return { error: error.message };

  return { nBatches, batchSize };
}

/**
 * Drag-drop scheduler — set a single production_order's date.
 * Pass `date = null` to send the order back to the "Unscheduled" container.
 * Also updates day_of_week so floor screens that group by day-of-week stay
 * consistent. Won't touch orders that are already published (those should
 * be unpublished first if the operator wants to reschedule).
 */
export async function setProductionOrderDate(
  orderId: string,
  date: string | null
): Promise<{ error?: string }> {
  const supabase = await createClient();

  // Block reschedule of published orders — operator should explicitly
  // unpublish first to avoid floor confusion.
  const { data: existing } = await supabase
    .from("production_orders")
    .select("published_at, status")
    .eq("id", orderId)
    .single();
  if (existing?.published_at) {
    return { error: "Order is published. Unpublish the dept first to reschedule." };
  }
  if (existing && existing.status !== "planned") {
    return { error: `Order is ${existing.status}, can't reschedule.` };
  }

  // Compute day_of_week from the date (0 = Mon, 6 = Sun) — Supabase stores
  // ISO date strings; JS Date.getDay() returns 0=Sun..6=Sat, so shift.
  let dayOfWeek: number | null = null;
  if (date) {
    const d = new Date(date + "T00:00:00Z");
    const jsDow = d.getUTCDay(); // 0=Sun..6=Sat
    dayOfWeek = (jsDow + 6) % 7;  // 0=Mon..6=Sun
  }

  const { error } = await supabase
    .from("production_orders")
    .update({ production_date: date, day_of_week: dayOfWeek })
    .eq("id", orderId);
  if (error) return { error: error.message };

  return {};
}

/**
 * Day-cascade — when a parent production order is moved to a date, every
 * downstream order in the same demand chain (i.e. orders for items that
 * consume the parent's item via active BOMs) auto-moves to the same date.
 *
 * Tino May 2026: planner workflow ask. Initial position only — once cascaded,
 * the planner can pull individual stages to other days as needed (cooking
 * Mon, filling Tue, packing Wed, etc.). Saves a lot of repetitive dragging
 * across the four-stage chain.
 *
 * Walks UP the BOM consumer tree via the get_consumer_tree RPC (mig 093),
 * scoped to the same demand_plan_id, skipping orders that are already
 * published (those are committed to the floor and refuse moves anyway).
 *
 * Returns the number of orders that were actually moved.
 */
export async function cascadeOrderDateToConsumers(
  orderId: string,
  date: string
): Promise<{ moved?: number; skipped?: number; error?: string }> {
  const supabase = await createClient();

  // Look up the parent order so we know which item to walk from and which
  // plan to scope the cascade to.
  const { data: parent } = await supabase
    .from("production_orders")
    .select("item_id, demand_plan_id")
    .eq("id", orderId)
    .single();
  if (!parent) return { error: "Parent order not found." };

  // Walk UP the BOM consumer tree. Returns every item that depends on
  // parent.item_id (directly or via chained BOMs).
  const { data: walk, error: walkErr } = await supabase
    .rpc("get_consumer_tree", { p_item_id: parent.item_id });
  if (walkErr) return { error: `Consumer tree RPC: ${walkErr.message}` };

  const consumerIds = ((walk as { consumer_item_ids?: string[] } | null)?.consumer_item_ids ?? []) as string[];
  if (consumerIds.length === 0) return { moved: 0, skipped: 0 };

  // Day-of-week from date for the same shift the per-order action does.
  const d = new Date(date + "T00:00:00Z");
  const dayOfWeek = (d.getUTCDay() + 6) % 7;

  // Update everything in the same plan whose item is downstream of the
  // parent. Skip published orders — moving those would silently desync the
  // floor; the planner has to unfinalise first if they really want to.
  const { data: updated, error: updErr } = await supabase
    .from("production_orders")
    .update({ production_date: date, day_of_week: dayOfWeek })
    .eq("demand_plan_id", parent.demand_plan_id)
    .in("item_id", consumerIds)
    .is("published_at", null)
    .select("id");
  if (updErr) return { error: updErr.message };

  // Count how many we couldn't touch (already published) so the UI can hint.
  const { count: totalCount } = await supabase
    .from("production_orders")
    .select("id", { count: "exact", head: true })
    .eq("demand_plan_id", parent.demand_plan_id)
    .in("item_id", consumerIds);
  const moved = updated?.length ?? 0;
  const skipped = (totalCount ?? 0) - moved;

  return { moved, skipped };
}

/**
 * Per-dept publish — stamps published_at on every scheduled (date IS NOT
 * NULL), unpublished, planned order belonging to the given dept on the
 * given plan. The floor screen for that dept now sees those orders.
 *
 * Per-dept rather than whole-plan so operators can finalise Production
 * while still iterating on Packing. Returns the count published.
 *
 * Aliases: passes the same alias list the floor pages use, so e.g. publish
 * "Production" also picks up legacy "wip" orders if any still exist.
 */
export async function publishDeptOrders(
  planId: string,
  deptAliases: string[]
): Promise<{ error?: string; published?: number; unscheduled?: number }> {
  const supabase = await createClient();
  const now = new Date().toISOString();


  // Build case-variant set so DB-side .in() match works against any of the
  // department spellings the floor pages also accept.
  const variants = new Set<string>();
  for (const a of deptAliases) {
    variants.add(a);
    variants.add(a.toLowerCase());
    variants.add(a.toUpperCase());
    variants.add(a.charAt(0).toUpperCase() + a.slice(1).toLowerCase());
  }
  const aliasList = [...variants];

  // Count any unscheduled (date IS NULL) orders so we can warn the operator
  // before publish — usually the operator wants to schedule everything first.
  const { count: unscheduledCount } = await supabase
    .from("production_orders")
    .select("*", { count: "exact", head: true })
    .eq("demand_plan_id", planId)
    .in("department", aliasList)
    .is("published_at", null)
    .is("production_date", null)
    .eq("status", "planned");

  // Publish: every dept order with a date set, not yet published, status planned.
  const { data: rows, error } = await supabase
    .from("production_orders")
    .update({ published_at: now })
    .eq("demand_plan_id", planId)
    .in("department", aliasList)
    .is("published_at", null)
    .not("production_date", "is", null)
    .eq("status", "planned")
    .select("id");
  if (error) return { error: error.message };

  return { published: rows?.length ?? 0, unscheduled: unscheduledCount ?? 0 };
}

/**
 * Per-day variant — same as publishDeptOrders but narrowed to a single
 * production_date. Lets a planner finalise Monday's orders while still
 * shaping the rest of the week (small operators don't plan a week ahead).
 */
export async function publishDeptOrdersForDay(
  planId: string,
  deptAliases: string[],
  productionDate: string
): Promise<{ error?: string; published?: number }> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const variants = new Set<string>();
  for (const a of deptAliases) {
    variants.add(a);
    variants.add(a.toLowerCase());
    variants.add(a.toUpperCase());
    variants.add(a.charAt(0).toUpperCase() + a.slice(1).toLowerCase());
  }
  const { data: rows, error } = await supabase
    .from("production_orders")
    .update({ published_at: now })
    .eq("demand_plan_id", planId)
    .in("department", [...variants])
    .eq("production_date", productionDate)
    .is("published_at", null)
    .eq("status", "planned")
    .select("id");
  if (error) return { error: error.message };
  return { published: rows?.length ?? 0 };
}

export async function unpublishDeptOrdersForDay(
  planId: string,
  deptAliases: string[],
  productionDate: string
): Promise<{ error?: string; unpublished?: number }> {
  const supabase = await createClient();
  const variants = new Set<string>();
  for (const a of deptAliases) {
    variants.add(a);
    variants.add(a.toLowerCase());
    variants.add(a.toUpperCase());
    variants.add(a.charAt(0).toUpperCase() + a.slice(1).toLowerCase());
  }
  const { data: rows, error } = await supabase
    .from("production_orders")
    .update({ published_at: null })
    .eq("demand_plan_id", planId)
    .in("department", [...variants])
    .eq("production_date", productionDate)
    .not("published_at", "is", null)
    .eq("status", "planned")
    .select("id");
  if (error) return { error: error.message };
  return { unpublished: rows?.length ?? 0 };
}

/**
 * Unpublish a dept's orders — flips published_at back to null so they
 * disappear from the floor screen and become reschedulable in the planner.
 * Used when the operator realises a mistake after publishing. Won't touch
 * orders that are past 'planned' (operator already started — too late).
 */
export async function unpublishDeptOrders(
  planId: string,
  deptAliases: string[]
): Promise<{ error?: string; unpublished?: number }> {
  const supabase = await createClient();
  const variants = new Set<string>();
  for (const a of deptAliases) {
    variants.add(a);
    variants.add(a.toLowerCase());
    variants.add(a.toUpperCase());
    variants.add(a.charAt(0).toUpperCase() + a.slice(1).toLowerCase());
  }
  const { data: rows, error } = await supabase
    .from("production_orders")
    .update({ published_at: null })
    .eq("demand_plan_id", planId)
    .in("department", [...variants])
    .not("published_at", "is", null)
    .eq("status", "planned")
    .select("id");
  if (error) return { error: error.message };
  return { unpublished: rows?.length ?? 0 };
}

/**
 * Per-order publish/unpublish — operator wants to fix one specific order
 * without disturbing the rest of the dept or plan.
 */
export async function publishProductionOrder(
  orderId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("production_orders")
    .select("status, production_date, published_at")
    .eq("id", orderId)
    .single();
  if (!existing) return { error: "Order not found" };
  if (existing.status !== "planned") {
    return { error: `Order is ${existing.status}, can't publish.` };
  }
  if (!existing.production_date) {
    return { error: "Set a production date before publishing this order." };
  }
  if (existing.published_at) {
    return {};
  }
  const { error } = await supabase
    .from("production_orders")
    .update({ published_at: new Date().toISOString() })
    .eq("id", orderId);
  if (error) return { error: error.message };
  revalidatePath("/dept", "layout");
  revalidatePath(`/work-orders/${orderId}`);
  return {};
}

export async function unpublishProductionOrder(
  orderId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("production_orders")
    .select("status, published_at")
    .eq("id", orderId)
    .single();
  if (!existing) return { error: "Order not found" };
  if (existing.status !== "planned") {
    return { error: `Order is ${existing.status}, too late to unpublish.` };
  }
  if (!existing.published_at) {
    return {};
  }
  const { error } = await supabase
    .from("production_orders")
    .update({ published_at: null })
    .eq("id", orderId);
  if (error) return { error: error.message };
  revalidatePath("/dept", "layout");
  revalidatePath(`/work-orders/${orderId}`);
  return {};
}


/**
 * Lock & Publish a demand plan — flips status to 'locked', stamps locked_at,
 * and publishes the plan's production_orders to the floor screens.
 */
export async function lockAndPublishPlan(
  planId: string
): Promise<{ error?: string; orderCount?: number }> {
  const supabase = await createClient();
  const { count, error: countErr } = await supabase
    .from("production_orders")
    .select("*", { count: "exact", head: true })
    .eq("demand_plan_id", planId);
  if (countErr) return { error: countErr.message };
  if (!count || count === 0) {
    return { error: "No production orders for this plan yet. Click Save & Build Work Orders first." };
  }

  const now = new Date().toISOString();
  await supabase
    .from("production_orders")
    .update({ published_at: now })
    .eq("demand_plan_id", planId)
    .is("published_at", null)
    .eq("status", "planned");

  const { error } = await supabase
    .from("demand_plans")
    .update({ status: "locked", locked_at: now })
    .eq("id", planId);
  if (error) return { error: error.message };

  revalidatePath(`/plans/${planId}`);
  return { orderCount: count };
}


/**
 * Re-sequence work orders within a day/machine bucket. The operator sees the
 * cards in run_sequence order on the floor; this lets them re-order them
 * with up/down arrows or drag-reorder.
 *
 * Pass an array of orderIds in the desired order — we set run_sequence = index
 * so the array is the new order. All passed orders should belong to the same
 * (production_date, dept, [machine_id]) bucket but the action doesn't enforce
 * that — it just sets run_sequence per the array.
 */
export async function reorderOrdersInBucket(orderIds: string[]): Promise<{ ok: true } | { error: string }> {
  if (!Array.isArray(orderIds) || orderIds.length === 0) return { ok: true };
  const supabase = await createClient();
  for (let i = 0; i < orderIds.length; i++) {
    const { error } = await supabase
      .from("production_orders")
      .update({ run_sequence: i + 1 })
      .eq("id", orderIds[i]);
    if (error) return { error: error.message };
  }
  return { ok: true };
}
