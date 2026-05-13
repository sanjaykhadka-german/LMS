/**
 * Work order detail page — opened in a popup window from any floor screen.
 *
 * What the operator sees:
 *   • Header: item code/name, batch number, planned qty, status, priority,
 *     production date, machine/room, demand-plan link.
 *   • BOM table: every component the recipe expects, with its per-batch qty,
 *     UOM, and the same component's "total usage on this date" rolled up
 *     across every published production order running today.
 *   • Per-row: a "Record batches" button → opens an inline modal letting the
 *     operator enter one or more (batch_number, qty) rows. After save, the
 *     row shows the comma-separated summary "B-001 (5 kg), B-002 (3 kg)".
 *
 * Data sources:
 *   • production_orders → the work order itself
 *   • bom_headers + bom_lines (latest active version) → the recipe
 *   • production_orders + bom_lines → "total usage today" (server-side sum)
 *   • production_order_consumption → existing batch entries
 */

import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { formatQty } from "@/lib/format";
import WorkOrderClient from "./_components/work-order-client";
import PublishToggle from "./_components/publish-toggle";

type BomLine = {
  componentItemId: string;
  code: string;
  name: string;
  itemType: string;
  unit: string;
  qtyPerRefBatch: number;       // BOM-line raw qty per the recipe's reference batch size
  percentage: number | null;   // Canonical share of the weight-ingredient total (post mig 108)
  refBatchSize: number;          // BOM header's reference_batch_size
  yieldFactor: number;           // BOM header's yield_factor (1.0 = no loss)
  qtyForThisOrder: number;       // qty to consume to make this order's planned_qty
  qtyTotalForDay: number;        // qty consumed across ALL published orders running today
  grindSize: string | null;      // bom_lines.grind_size — e.g. "8mm" for mince
  lineComment: string | null;    // bom_lines.comment — free text on this ingredient
  // Item taxonomy — populated via two extra lookups after the bom_lines query
  // so we can colour the row by category and let the operator multi-sort.
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;  // e.g. "#fef3c7"
  subcategoryId: string | null;
  subcategoryName: string | null;
  consumedLots: { batch_number: string; qty_used: number; unit: string }[];
};

/** Item attributes surfaced in the header — populated only with the fields
 *  that exist for THIS item type (filling-only fields blank for raw materials,
 *  etc.). Drives the right-hand "Specs" card on the work order page. */
type ItemAttrs = {
  storageTemp: string | null;
  shelfLife: string | null;
  packaging: string | null;
  labelling: string | null;
  minShelfLifeDays: number | null;
  fillWeightG: number | null;
  fillWeightRawG: number | null;
  targetWeightG: number | null;
  unitsPerInner: number | null;
  unitsPerOuter: number | null;
  productionMethod: string | null;
};

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // Pull current user's role so we can gate the QA-lock controls (admin only
  // for now; will switch to QA when role-based access lands later).
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";

  // ── Load the work order with everything we need to render the header ───────
  const { data: order } = await supabase
    .from("production_orders")
    .select(`
      id, batch_number, department, production_date, day_of_week,
      planned_qty, batch_size, n_of_batches, unit, status, priority,
      machine, room, notes, published_at,
      actual_qty, actual_batch_size, actual_n_of_batches,
      injection_target_pct, actual_pct_injected, tumble_hours,
      batch_recipe_approved,
      bom_header_id_used, bom_version_used,
      traceability_locked_at, traceability_locked_by,
      item:item_id(
        id, code, name, item_type, unit, production_method,
        spec_packaging, spec_labelling, spec_shelf_life, spec_storage_temp,
        min_shelf_life_days, fill_weight_g, target_weight_g,
        units_per_inner, units_per_outer, default_batch_size
      ),
      demand_plan:demand_plan_id(id, week_start),
      locked_by:traceability_locked_by(id, full_name)
    `)
    .eq("id", id)
    .single();
  if (!order) notFound();
  const lockedByProfile = (Array.isArray(order.locked_by) ? order.locked_by[0] : order.locked_by) as
    { id: string; full_name: string | null } | null;

  const itemForOrder = (Array.isArray(order.item) ? order.item[0] : order.item) as {
    id: string; code: string; name: string; item_type: string; unit: string; production_method: string | null;
    spec_packaging: string | null; spec_labelling: string | null;
    spec_shelf_life: string | null; spec_storage_temp: string | null;
    min_shelf_life_days: number | null;
    fill_weight_g: number | null; target_weight_g: number | null;
    units_per_inner: number | null; units_per_outer: number | null;
    default_batch_size: number | null;
  } | null;
  const attrs: ItemAttrs = {
    storageTemp: itemForOrder?.spec_storage_temp ?? null,
    shelfLife: itemForOrder?.spec_shelf_life ?? null,
    packaging: itemForOrder?.spec_packaging ?? null,
    labelling: itemForOrder?.spec_labelling ?? null,
    minShelfLifeDays: itemForOrder?.min_shelf_life_days ?? null,
    fillWeightG: itemForOrder?.fill_weight_g ?? null,
    fillWeightRawG: null, // bom_headers carries the raw fill weight, not items
    targetWeightG: itemForOrder?.target_weight_g ?? null,
    unitsPerInner: itemForOrder?.units_per_inner ?? null,
    unitsPerOuter: itemForOrder?.units_per_outer ?? null,
    productionMethod: itemForOrder?.production_method ?? null,
  };
  const planForOrder = (Array.isArray(order.demand_plan) ? order.demand_plan[0] : order.demand_plan) as {
    id: string; week_start: string;
  } | null;

  // ── Load the active BOM for this item ─────────────────────────────────────
  // bom_headers is versioned; pick the highest is_active version.
  let bomLines: BomLine[] = [];
  let bomHeader: { id: string; reference_batch_size: number; yield_factor: number } | null = null;
  if (itemForOrder) {
    const { data: header } = await supabase
      .from("bom_headers")
      .select("id, reference_batch_size, yield_factor")
      .eq("item_id", itemForOrder.id)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    bomHeader = header ?? null;

    if (bomHeader) {
      const { data: lines } = await supabase
        .from("bom_lines")
        .select(`
          id, qty_per_batch, unit, sort_order, grind_size, comment, percentage,
          component:component_item_id(id, code, name, item_type, unit)
        `)
        .eq("bom_header_id", bomHeader.id)
        .order("sort_order");

      // For each line, compute:
      //   qtyForThisOrder = (qty_per_batch / reference_batch_size) × planned_qty / yield
      //   "qty_per_batch" in bom_lines is the qty for the WHOLE recipe at the
      //   reference_batch_size — so we scale linearly by planned_qty.
      const scale = bomHeader.reference_batch_size > 0
        ? (Number(order.planned_qty) || 0) / Number(bomHeader.reference_batch_size)
        : 0;
      const yieldDiv = bomHeader.yield_factor > 0 ? Number(bomHeader.yield_factor) : 1;

      bomLines = (lines ?? []).map(l => {
        const c = (Array.isArray(l.component) ? l.component[0] : l.component) as
          { id: string; code: string; name: string; item_type: string; unit: string } | null;
        // Prefer percentage when set on a kg-unit line — that's the canonical
        // recipe source post migration 108. qty_per_batch is informational only
        // when percentage is present (e.g. recipe says "63 kg per 1000 kg ref"
        // but the actual rule is "62.83% of weight inputs"). Falls back to the
        // qty_per_batch ratio for non-weight lines (per_piece etc).
        const lineUnit = (l.unit || "").toLowerCase();
        const pct = l.percentage != null ? Number(l.percentage) : null;
        const usePct = lineUnit === "kg" && pct != null && pct > 0;
        const qtyForThisOrder = c
          ? (usePct
              ? (Number(order.planned_qty) || 0) * (pct! / 100) / yieldDiv
              : (Number(l.qty_per_batch) * scale) / yieldDiv)
          : 0;
        return {
          componentItemId: c?.id ?? "",
          code: c?.code ?? "?",
          name: c?.name ?? "—",
          itemType: c?.item_type ?? "",
          unit: l.unit || c?.unit || "kg",
          qtyPerRefBatch: Number(l.qty_per_batch) || 0,
          percentage: l.percentage != null ? Number(l.percentage) : null,
          refBatchSize: Number(bomHeader!.reference_batch_size) || 0,
          yieldFactor: yieldDiv,
          qtyForThisOrder,
          qtyTotalForDay: 0, // filled in below
          grindSize: (l as { grind_size?: string | null }).grind_size ?? null,
          lineComment: (l as { comment?: string | null }).comment ?? null,
          categoryId: null,           // filled in below
          categoryName: null,
          categoryColor: null,
          subcategoryId: null,
          subcategoryName: null,
          consumedLots: [],
        };
      }).filter(l => l.componentItemId);

      // ── Hydrate category/subcategory for each component ────────────────
      // Pull all components in one round-trip + their category/subcategory
      // so the table can render row-tinted-by-category and let the operator
      // sort by Type / Category / Subcategory.
      const componentIds = bomLines.map(l => l.componentItemId);
      if (componentIds.length > 0) {
        const { data: itemsTax } = await supabase
          .from("items")
          .select(`
            id, item_category_id, item_subcategory_id,
            category:item_category_id(id, name, color),
            subcategory:item_subcategory_id(id, name)
          `)
          .in("id", componentIds);
        type TaxRow = {
          id: string;
          item_category_id: string | null;
          item_subcategory_id: string | null;
          category: { id: string; name: string; color: string | null } | { id: string; name: string; color: string | null }[] | null;
          subcategory: { id: string; name: string } | { id: string; name: string }[] | null;
        };
        const taxByItem = new Map<string, TaxRow>();
        for (const row of (itemsTax ?? []) as TaxRow[]) taxByItem.set(row.id, row);
        for (const line of bomLines) {
          const t = taxByItem.get(line.componentItemId);
          if (!t) continue;
          const cat = (Array.isArray(t.category) ? t.category[0] : t.category) ?? null;
          const sub = (Array.isArray(t.subcategory) ? t.subcategory[0] : t.subcategory) ?? null;
          line.categoryId = cat?.id ?? null;
          line.categoryName = cat?.name ?? null;
          line.categoryColor = cat?.color ?? null;
          line.subcategoryId = sub?.id ?? null;
          line.subcategoryName = sub?.name ?? null;
        }
      }
    }
  }

  // The "Total today" cross-recipe rollup column was removed in May 2026 (it
  // duplicated the Total Production column whenever there was only one order
  // per recipe per day, which is the common case). The 3 round-trips that
  // built it (orders today → BOM headers → BOM lines) were causing slow
  // first-paint on the work-order popup so they're gone too. We still set
  // qtyTotalForDay = qtyForThisOrder so any future column re-adds work
  // without re-introducing the queries.
  for (const line of bomLines) line.qtyTotalForDay = line.qtyForThisOrder;

  // ── Existing consumption rows ─────────────────────────────────────────────
  const { data: consumption } = await supabase
    .from("production_order_consumption")
    .select("component_item_id, batch_number, qty_used, unit")
    .eq("production_order_id", id);
  const lotsByComp = new Map<string, { batch_number: string; qty_used: number; unit: string }[]>();
  for (const c of (consumption ?? [])) {
    if (!lotsByComp.has(c.component_item_id)) lotsByComp.set(c.component_item_id, []);
    lotsByComp.get(c.component_item_id)!.push({
      batch_number: c.batch_number,
      qty_used: Number(c.qty_used),
      unit: c.unit,
    });
  }
  for (const line of bomLines) {
    line.consumedLots = lotsByComp.get(line.componentItemId) ?? [];
  }

  const STATUS_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
    planned:     { label: "Planned",     bg: "#fef3c7", fg: "#92400e" },
    in_progress: { label: "In Progress", bg: "#dbeafe", fg: "#1e40af" },
    on_hold:     { label: "On Hold",     bg: "#fef3c7", fg: "#854d0e" },
    completed:   { label: "Completed",   bg: "#dcfce7", fg: "#166534" },
    cancelled:   { label: "Cancelled",   bg: "#fee2e2", fg: "#991b1b" },
  };
  const statusMeta = STATUS_LABEL[order.status] ?? STATUS_LABEL.planned;

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <BackButton href="/dept/production" label="Production Floor" />
            <span style={{ color: "#d4d4d4" }}>|</span>
            <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{order.batch_number}</span>
          </div>
          <h1 className="page-title" style={{ marginTop: "0.375rem" }}>
            🥩 {itemForOrder?.code ?? "?"} — {itemForOrder?.name ?? "—"}
          </h1>
          <div style={{ marginTop: "0.4rem", display: "flex", gap: "0.625rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{
              fontSize: "0.7rem", fontWeight: 700, padding: "0.15rem 0.55rem",
              borderRadius: "9999px", background: statusMeta.bg, color: statusMeta.fg,
              textTransform: "uppercase", letterSpacing: "0.04em",
            }}>{statusMeta.label}</span>
            {/* Per-order publish toggle — admin/planner only. Lets the planner
                pull a single order off the floor to edit without disturbing
                the whole dept's published set. */}
            <PublishToggle
              orderId={order.id}
              isPublished={!!order.published_at}
              status={order.status}
              hasProductionDate={!!order.production_date}
              isAdmin={isAdmin}
            />
            <span style={{ fontSize: "0.8125rem", color: "#57534e" }}>
              <strong>{formatQty(Number(order.planned_qty), order.unit)} {order.unit}</strong> planned
              {order.n_of_batches > 1 && <> · {order.n_of_batches} × {formatQty(Number(order.batch_size), order.unit)}</>}
            </span>
            {order.production_date && (
              <span style={{ fontSize: "0.8125rem", color: "#57534e" }}>
                📅 {new Date(order.production_date).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}
              </span>
            )}
            {order.machine && <span style={{ fontSize: "0.8125rem", color: "#57534e" }}>⚙ {order.machine}</span>}
            {order.room && <span style={{ fontSize: "0.8125rem", color: "#57534e" }}>🏠 {order.room}</span>}
            {order.actual_qty != null && (
              <span style={{ fontSize: "0.8125rem", color: "#166534", fontWeight: 600 }}>
                ✓ Actual: {formatQty(Number(order.actual_qty), order.unit)} {order.unit}
              </span>
            )}
          </div>
        </div>
      </div>

      {!bomHeader && (
        <div style={{ padding: "1.25rem", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "0.5rem", color: "#854d0e", marginBottom: "1rem" }}>
          <strong>No active BOM</strong> — this item has no recipe set up yet, so there's nothing to record consumption against. Open the item in BOM Master to create one.
        </div>
      )}

      {bomHeader && bomLines.length === 0 && (
        <div style={{ padding: "1.25rem", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "0.5rem", color: "#854d0e", marginBottom: "1rem" }}>
          <strong>BOM has no lines</strong> — the recipe exists but no components are listed. Add ingredients in BOM Master.
        </div>
      )}

      {bomHeader && bomLines.length > 0 && (
        <WorkOrderClient
          orderId={order.id}
          orderUnit={order.unit}
          plannedQty={Number(order.planned_qty)}
          batchSize={Number(order.batch_size)}
          nOfBatches={Number(order.n_of_batches) || 1}
          actualQty={order.actual_qty != null ? Number(order.actual_qty) : null}
          actualBatchSize={order.actual_batch_size != null ? Number(order.actual_batch_size) : null}
          actualNOfBatches={order.actual_n_of_batches != null ? Number(order.actual_n_of_batches) : null}
          refBatchSize={Number(bomHeader.reference_batch_size)}
          yieldFactor={Number(bomHeader.yield_factor)}
          weekStart={planForOrder?.week_start ?? null}
          productionDate={order.production_date}
          plannerNotes={order.notes ?? null}
          itemAttrs={attrs}
          itemDept={order.department ?? null}
          bomLines={bomLines}
          bomVersionUsed={order.bom_version_used ?? null}
          lockedAt={order.traceability_locked_at ?? null}
          lockedByName={lockedByProfile?.full_name ?? null}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}
