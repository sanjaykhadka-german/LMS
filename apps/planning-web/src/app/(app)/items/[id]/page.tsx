import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ITEM_TYPE_LABELS, ITEM_TYPE_COLORS, PRODUCTION_METHOD_LABELS, type ItemType, type ProductionMethod } from "@/lib/types";
import { BackButton } from "@/components/back-button";
import { QuickNav } from "@/components/quick-nav";
import { ProductTreeCard, type TreeItem } from "@/components/product-tree";
import { formatQty, formatPercent } from "@/lib/format";
import { getTenantId } from "@/lib/tenant";
import ItemSpecDocsPanel from "../_components/item-spec-docs-panel";
import ItemSuppliersPanel from "../_components/item-suppliers-panel";
import ItemSupplierSpecsPanel from "../_components/item-supplier-specs-panel";
import ItemComponentsPanel from "../_components/item-components-panel";
import BomCard from "../_components/bom-card";
import BomFormModal from "../../bom/_components/bom-form-modal";
import TestProductButton from "./_components/test-product-button";
import { TENANT_FULL_FETCH } from "@/lib/limits";
import { fetchAllRows } from "@/lib/fetch-all";
import CostSummaryCard from "./_components/cost-summary-card";
import FamilyContextStrip, { type FamilyItem } from "./_components/family-context-strip";
import PricingMatrix, { type ItemPackInfo, type PriceGroupRow, type PriceLine } from "./_components/pricing-matrix";
import { computeBuildup } from "./_components/loaded-cost-math";

const IMAGE_SLOTS: { key: "product" | "inner" | "outer" | "pallet"; label: string; emoji: string }[] = [
  { key: "product", label: "Product",     emoji: "🥩" },
  { key: "inner",   label: "Inner pack",  emoji: "📦" },
  { key: "outer",   label: "Outer/carton",emoji: "📦" },
  { key: "pallet",  label: "Pallet",      emoji: "🟫" },
];

export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ fromStocktake?: string; back_to_test?: string; openTest?: string; qty?: string; uom?: string; just_created?: string }>;
}) {
  const { id } = await params;
  const sp = searchParams ? await searchParams : undefined;
  const fromStocktake = sp?.fromStocktake ?? null;
  const backToTestId  = sp?.back_to_test ?? null;
  const autoOpenTest  = sp?.openTest === "1";
  const restoredQty   = sp?.qty ? parseFloat(sp.qty) : undefined;
  const restoredUom   = (sp?.uom as "units"|"kg"|"inner"|"outer"|"pallet"|undefined) ?? undefined;
  const justCreated   = sp?.just_created === "1";
  const supabase = await createClient();

  // Viewer role — only manager/admin can re-parent items via drag/drop.
  const { data: { user } } = await supabase.auth.getUser();
  const { data: viewerProfile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const viewerRole = (viewerProfile as { role?: string } | null)?.role ?? "viewer";
  const canEditTree = ["super_admin", "admin", "manager"].includes(viewerRole);

  // All queries run in parallel — the slowest determines page load time.
  const [
    { data: item }, { data: children }, { data: boms }, { data: usedIn }, { data: images }, tenantId,
    { data: suppliers }, { data: specDocs }, { data: supplierLinks }, { data: productSpecs },
    { data: palletConfig }, { data: allItemsForTree },
    { data: costBreakdown }, { data: buffersRow }, { data: ancestorRows }, { data: priceGroupsRows }, { data: priceLinesRows },
  ] = await Promise.all([
    supabase.from("items").select("*, parent:parent_item_id(id, code, name, item_type), item_category:item_category_id(id, name, color), item_subcategory:item_subcategory_id(id, name)").eq("id", id).single(),
    fetchAllRows((from, to) => supabase.from("items").select("id, code, name, item_type, unit, current_stock").eq("parent_item_id", id).order("code").range(from, to)),
    supabase.from("bom_headers").select("*, lines:bom_lines(*, component_item:component_item_id(id, code, name, unit, item_type, consumed_in_weight))").eq("item_id", id).order("version").limit(100),
    fetchAllRows((from, to) => supabase.from("bom_lines").select("bom_header:bom_header_id(item:item_id(id, code, name, item_type))").eq("component_item_id", id).range(from, to)),
    supabase.from("item_images").select("id, storage_path, file_name, mime_type, size_bytes, is_primary, sort_order, image_type").eq("item_id", id).order("is_primary", { ascending: false }).order("sort_order"),
    getTenantId(),
    fetchAllRows((from, to) => supabase.from("suppliers").select("id, name, code").eq("is_active", true).order("name").range(from, to)),
    supabase.from("item_spec_documents").select("*, supplier:supplier_id(id, name)").eq("item_id", id).order("created_at", { ascending: false }),
    supabase.from("supplier_items").select("id, supplier_item_code, supplier_item_name, unit_price, currency, price_valid_from, price_valid_to, purchase_uom, purchase_uom_qty, min_order_qty, lead_time_days, is_preferred, notes, supplier:supplier_id(id, name, code)").eq("item_id", id).order("is_preferred", { ascending: false }),
    supabase.from("product_specs").select("id, version, version_label, status, approved_at, updated_at").eq("item_id", id).order("version", { ascending: false }).limit(50),
    supabase.from("item_pallet_config").select("*").eq("item_id", id).maybeSingle(),
    // Product Tree: ancestors + self + every descendant of this item, in one
    // recursive-CTE round trip. Bulletproof against row limits / missed joins.
    supabase.rpc("get_item_tree", { p_item_id: id }),
    // Cost summary card (admin-only, rendered below) — call cost_breakdown_v2
    // so we get per-stage losses for the walk (the FG's own losses alone
    // would miss production loss on WIP, cooking on WIPF, packing on WIPP,
    // etc — same fix as the /costings breakdown page).
    supabase.rpc("cost_breakdown_v2", { p_item_id: id }),
    supabase.from("v_pricing_buffers_current").select("production_loss_pct, cooking_loss_pct, packing_loss_pct, open_pack_pct, giveaway_pct, depreciation_pct, sample_pct, product_dev_pct, error_pct, target_margin_pct").maybeSingle(),
    // Family lineage — ancestor chain via parent_item_id (mig 137 RPC).
    supabase.rpc("get_item_ancestors", { p_item_id: id }),
    // Pricing matrix — every active price group for this tenant + the
    // explicit per-item-per-group price rows. Migration 138 added the `unit`
    // column so each line knows its UOM.
    supabase.from("price_groups")
      .select("id, code, name, default_margin_pct, default_target_unit, sort_order, is_active, is_standard")
      .eq("is_active", true)
      .order("sort_order", { nullsFirst: false })
      .order("name"),
    supabase.from("price_group_lines")
      .select("id, price_group_id, unit_price, unit, currency, valid_from, valid_to, updated_at")
      .eq("item_id", id),
  ]);

  if (!item) notFound();

  // ── Family context — lineage + consumers ──────────────────────────────
  // Build a list of related-item IDs (ancestors + consumers) and batch a
  // single cost-view query for all of them so the mini-cards can show COGS
  // at-a-glance. Lineage = walk up parent_item_id; consumers = items whose
  // active BOM uses THIS item (we already have `usedIn` from above).
  //
  // Wrapped in try/catch so a transient failure (RPC missing, view error,
  // unexpected Supabase relationship shape) degrades to "no strip" instead
  // of a 500 on the whole item master page. Tino May 2026.
  let lineageFamilyItems: FamilyItem[] = [];
  let consumerFamilyItems: FamilyItem[] = [];
  try {
    const ancestors = (ancestorRows ?? []) as Array<{ id: string; code: string; name: string; item_type: string; unit: string | null; depth: number }>;
    const consumerItemMap = new Map<string, { id: string; code: string; name: string; item_type: string }>();
    // Supabase typing: nested relationships come back as arrays even when
    // there's only ever one row, so we unwrap defensively.
    for (const row of (usedIn ?? []) as unknown as Array<{ bom_header: unknown }>) {
      const bhRaw = row?.bom_header;
      if (!bhRaw) continue;
      const bh = Array.isArray(bhRaw) ? bhRaw[0] : bhRaw;
      if (!bh || typeof bh !== "object") continue;
      const itemRaw = (bh as { item?: unknown }).item;
      if (!itemRaw) continue;
      const owner = Array.isArray(itemRaw) ? itemRaw[0] : itemRaw;
      if (!owner || typeof owner !== "object") continue;
      const o = owner as { id?: string; code?: string; name?: string; item_type?: string };
      if (o.id && o.code && o.name && o.item_type && !consumerItemMap.has(o.id)) {
        consumerItemMap.set(o.id, { id: o.id, code: o.code, name: o.name, item_type: o.item_type });
      }
    }
    const familyIds = new Set<string>([
      ...ancestors.map(a => a.id),
      ...consumerItemMap.keys(),
    ]);
    const familyCostMap = new Map<string, number>();
    if (familyIds.size > 0) {
      const { data: familyCosts, error: familyCostsErr } = await supabase
        .from("v_item_landed_cost_v3")
        .select("item_id, total_cost_per_unit")
        .in("item_id", Array.from(familyIds));
      if (!familyCostsErr) {
        for (const c of (familyCosts ?? []) as Array<{ item_id: string; total_cost_per_unit: number | string | null }>) {
          const n = c.total_cost_per_unit == null ? null : Number(c.total_cost_per_unit);
          if (n != null && Number.isFinite(n)) familyCostMap.set(c.item_id, n);
        }
      }
    }
    lineageFamilyItems = ancestors.map(a => ({
      id: a.id,
      code: a.code,
      name: a.name,
      item_type: a.item_type,
      unit: a.unit,
      cogs: familyCostMap.get(a.id) ?? null,
    }));
    consumerFamilyItems = Array.from(consumerItemMap.values()).map(c => ({
      id: c.id,
      code: c.code,
      name: c.name,
      item_type: c.item_type,
      unit: null,
      cogs: familyCostMap.get(c.id) ?? null,
    })).sort((a, b) => a.code.localeCompare(b.code));
  } catch (err) {
    // Swallow — strips stay empty, page still renders. Log so we see it
    // in Vercel runtime logs without blowing up the user's view.
    console.error("[items/[id]] family-context fetch failed", err);
  }

  // If we arrived here from a "Test this product" modal on another item, fetch
  // that parent item's code so we can show a "Back to test" banner and link.
  let backToTestItem: { id: string; code: string; name: string } | null = null;
  if (backToTestId && backToTestId !== id) {
    const { data: parentTested } = await supabase
      .from("items")
      .select("id, code, name")
      .eq("id", backToTestId)
      .single();
    backToTestItem = parentTested as { id: string; code: string; name: string } | null;
  } else if (backToTestId === id) {
    // User arrived from the test modal of THIS item (e.g. came back from Edit page)
    backToTestItem = { id: item.id, code: item.code, name: item.name };
  }

  // Signed URLs for the 4 packaging-strip images — generated in parallel (was sequential).
  const slotEntries = await Promise.all(
    IMAGE_SLOTS.map(async slot => {
      const img = (images ?? []).find(i => (i as any).image_type === slot.key);
      if (!img) return [slot.key, null] as const;
      const { data: signed } = await supabase.storage
        .from("item-images")
        .createSignedUrl((img as any).storage_path, 3600);
      return [slot.key, { url: signed?.signedUrl ?? "", file_name: (img as any).file_name ?? "" }] as const;
    })
  );
  const slotImages: Record<string, { url: string; file_name: string } | null> =
    Object.fromEntries(slotEntries);

  const isLow = item.current_stock <= item.min_stock && item.min_stock > 0;
  const isProduced = item.procurement_type === "produce";
  const isRawOrPackaging = item.item_type === "raw_material" || item.item_type === "packaging";

  // Unique parent items that "use" this item as a component
  const usedInItems = usedIn
    ? [...new Map(usedIn.map(u => {
        const bom = (u as any).bom_header as { item: { id: string; code: string; name: string; item_type: string } } | null;
        return [bom?.item?.id, bom?.item];
      })).values()].filter(Boolean)
    : [];

  // ─── Pallet maths ─────────────────────────────────────────
  const ti = palletConfig?.ti ?? null;
  const hi = palletConfig?.hi ?? null;
  const cartonsPerPallet = (ti != null && hi != null) ? ti * hi : null;
  const unitsPerPallet   = (cartonsPerPallet != null && item.units_per_outer != null)
    ? cartonsPerPallet * item.units_per_outer : (palletConfig?.units_per_pallet ?? null);

  // ─── Spec docs split ──────────────────────────────────────
  const docs = (specDocs ?? []) as any[];
  const pifDocs = docs.filter(d => d.document_type === "pif");
  const customerDocs = docs.filter(d => d.document_type !== "pif");

  // ─── Tree items: results from get_item_tree RPC (recursive CTE), shaped
  // into TreeItem objects. Guaranteed to include every ancestor + descendant
  // of the current item, regardless of tenant size or item types involved.
  type RpcRow = {
    id: string; code: string; name: string;
    item_type: string; parent_item_id: string | null;
    category_name: string | null; subcategory_name: string | null;
    sort_order: number | null;
  };
  const treeItems: TreeItem[] = ((allItemsForTree ?? []) as RpcRow[]).map(r => ({
    id: r.id,
    code: r.code,
    name: r.name,
    item_type: r.item_type,
    parent_item_id: r.parent_item_id,
    sort_order: r.sort_order ?? 0,
    item_category:    r.category_name    ? { name: r.category_name }    : null,
    item_subcategory: r.subcategory_name ? { name: r.subcategory_name } : null,
  }));

  return (
    <div>
      {/* ─── Back-to-test banner (when arrived from a "Test this product" modal) */}
      {backToTestItem && (
        <a
          href={`/items/${backToTestItem.id}?openTest=1${restoredQty ? `&qty=${restoredQty}` : ""}${restoredUom ? `&uom=${restoredUom}` : ""}`}
          style={{
            display: "flex", alignItems: "center", gap: "0.625rem",
            padding: "0.625rem 0.875rem", marginBottom: "1rem",
            background: "linear-gradient(90deg, #fef2f2, #fef9c3)",
            border: "1px solid #fde68a",
            borderRadius: "0.5rem",
            textDecoration: "none",
            color: "#854d0e",
            fontSize: "0.875rem",
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: "1rem" }}>←</span>
          <span>
            Back to test of <strong style={{ color: "#1c1917" }}>{backToTestItem.code}</strong>
            <span style={{ color: "#a8a29e", marginLeft: "0.4rem" }}>· {backToTestItem.name}</span>
          </span>
          <span style={{ marginLeft: "auto", color: "#b91c1c", fontSize: "0.75rem", fontWeight: 600 }}>
            Re-open test →
          </span>
        </a>
      )}

      {/* ─── Just-created hint banner ────────────────────────── */}
      {justCreated && (
        <div style={{
          marginBottom: "1rem",
          padding: "1rem 1.125rem",
          background: "linear-gradient(90deg, #dcfce7, #ecfccb)",
          border: "1px solid #86efac",
          borderRadius: "0.5rem",
          fontSize: "0.875rem",
          color: "#166534",
        }}>
          <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
            ✓ {item.name} created. Here&apos;s what to do next:
          </div>
          <ol style={{ margin: "0.4rem 0 0 0", paddingLeft: "1.4rem", lineHeight: 1.7 }}>
            <li>Click <strong>+ Guided BOM</strong> (yellow button at top right) to define the recipe step-by-step. Or use <em>+ New BOM Version</em> for the classic editor.</li>
            <li>Once you have a BOM, click <strong>▷ Test this product</strong> to verify the cascade math.</li>
            <li>Add a customer spec / PIF if this is a sellable product (Customer Documents card below).</li>
          </ol>
        </div>
      )}

      {/* ─── Header ─────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            {fromStocktake ? (
              <BackButton href={`/stocktakes/${fromStocktake}`} label="Back to stocktake" />
            ) : (
              <BackButton href="/items" label="Item Master" rememberKey="items.lastListUrl" />
            )}
            <span style={{ color: "#d4d4d4" }}>|</span>
            <QuickNav />
            {item.parent && (
              <span style={{ color: "#78716c", fontSize: "0.875rem", marginLeft: "0.25rem" }}>
                → <Link href={`/items/${(item.parent as { id: string; code: string }).id}`} style={{ color: "#b91c1c", textDecoration: "none" }}>
                  {(item.parent as { code: string }).code}
                </Link>
              </span>
            )}
          </div>
          <h1 className="page-title" style={{ marginTop: "0.375rem" }}>
            {item.name}
            <span style={{ fontFamily: "monospace", fontSize: "1rem", fontWeight: 400, color: "#78716c", marginLeft: "0.5rem" }}>
              ({item.code})
            </span>
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginTop: "0.375rem", flexWrap: "wrap" }}>
            <span className={`badge ${ITEM_TYPE_COLORS[item.item_type as ItemType]}`}>{ITEM_TYPE_LABELS[item.item_type as ItemType]}</span>
            {item.item_type === "finished_good" && item.weight_mode === "random" && <span className="badge badge-yellow">⚖ Random Weight</span>}
            {item.item_type === "finished_good" && item.weight_mode === "fixed"  && <span className="badge badge-blue">Fixed Weight</span>}
            {item.is_active
              ? <span className="badge badge-green">● Active</span>
              : <span className="badge badge-gray">○ Inactive</span>}
            {item.is_rte && <span className="badge badge-green">✓ RTE</span>}
            {item.department && <span style={{ fontSize: "0.8125rem", color: "#78716c", textTransform: "capitalize" }}>· {item.department}</span>}
            {item.item_category && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3125rem", fontSize: "0.8125rem", color: "#78716c" }}>
                · <span style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: (item.item_category as { color: string }).color, display: "inline-block" }} />
                {(item.item_category as { name: string }).name}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.625rem", flexWrap: "wrap" }}>
          <TestProductButton
            itemId={id}
            itemName={item.name}
            itemCode={item.code}
            itemType={item.item_type}
            itemAttrs={{
              allergens:              item.allergens ?? null,
              is_rte:                 item.is_rte ?? null,
              ingredients_statement:  item.ingredients_statement ?? null,
              nut_energy_kj:          item.nut_energy_kj ?? null,
              spec_storage_temp:      item.spec_storage_temp ?? null,
              micro_reference:        item.micro_reference ?? null,
              units_per_inner:        item.units_per_inner ?? null,
              units_per_outer:        item.units_per_outer ?? null,
              outers_per_pallet:      item.outers_per_pallet ?? null,
              target_weight_g:        item.target_weight_g ?? null,
            }}
            autoOpen={autoOpenTest}
            defaultQty={restoredQty}
            defaultUom={restoredUom}
          />
          <Link href={`/items/${id}/bom/new`} className="btn-secondary" style={{ background: "#fef9c3", borderColor: "#fde68a", color: "#854d0e" }}>+ Guided BOM</Link>
          <Link href={`/specs/new?item_id=${id}`} className="btn-secondary">+ New Spec</Link>
          <BomFormModal defaultItemId={id} triggerLabel="+ New BOM Version" triggerClassName="btn-secondary" />
          {/* Duplicate Item — opens /items/new with the source item's data
              prefilled (minus code + current stock, which the user must
              enter for the copy). Linked rows in barcodes / BOMs / specs
              stay attached to the source. */}
          <Link
            href={`/items/new?duplicate_from=${id}`}
            className="btn-secondary"
            title="Open the New Item form pre-filled from this item — fill in a new code"
          >📋 Duplicate</Link>
          <Link href={`/items/${id}/edit`}        className="btn-primary">Edit Item</Link>
        </div>
      </div>

      {/* ─── Stock strip — pinned to the top of the page so the operator
            sees Current / Min / Max before anything else. Was previously
            buried inside the right-hand column of Row 1. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
        {[
          ["Current", `${item.current_stock} ${item.unit}`, isLow ? "#dc2626" : "#166534", isLow ? "#fef2f2" : "#dcfce7"],
          ["Min",     `${item.min_stock} ${item.unit}`,     "#92400e", "#fef3c7"],
          ["Max",     `${item.max_stock} ${item.unit}`,     "#1e40af", "#dbeafe"],
        ].map(([l, v, c, bg]) => (
          <div key={l as string} style={{ background: bg as string, borderRadius: "0.5rem", padding: "0.75rem 1rem" }}>
            <div style={{ fontSize: "0.7rem", color: c as string, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{l}</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: c as string, marginTop: "0.15rem" }}>{v}</div>
          </div>
        ))}
      </div>
      {isLow && (
        <div style={{ marginBottom: "1rem", padding: "0.625rem 0.875rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", fontSize: "0.8125rem", color: "#991b1b" }}>
          ⚠ Stock is below minimum level
        </div>
      )}

      {/* ─── Admin-only Cost Summary card ──────────────────────────
            Read-only buildup of Direct + Indirect + Losses + Markups +
            Min sell. Links to /costings/[id] for the full per-stage sheet.
            Gated on admin/manager role. Tino May 2026. */}
      {canEditTree && costBreakdown && (() => {
        const bd = costBreakdown as {
          totals: { rm: number | string; labour: number | string; overhead: number | string; total: number | string };
          stages: Array<{
            node_type: string; node_code: string;
            losses: {
              production_loss_pct: number | string | null;
              cooking_loss_pct:    number | string | null;
              packing_loss_pct:    number | string | null;
              open_pack_pct:       number | string | null;
              giveaway_pct:        number | string | null;
              process_loss_pct:    number | string | null;
            };
          }>;
        };
        return (
          <>
            {lineageFamilyItems.length > 0 && (
              <FamilyContextStrip
                variant="lineage"
                label="Family lineage"
                hint={`This item descends from ${lineageFamilyItems.length === 1 ? "1 parent" : `${lineageFamilyItems.length} ancestors`} in the family tree`}
                items={lineageFamilyItems}
              />
            )}
          <CostSummaryCard
            itemId={item.id}
            itemUnit={item.unit ?? "kg"}
            rm={Number(bd.totals.rm ?? 0)}
            labour={Number(bd.totals.labour ?? 0)}
            overhead={Number(bd.totals.overhead ?? 0)}
            stages={bd.stages ?? []}
            itemLosses={{
              production_loss_pct: (item as { production_loss_pct?: number | null }).production_loss_pct ?? null,
              cooking_loss_pct:    (item as { cooking_loss_pct?:    number | null }).cooking_loss_pct    ?? null,
              packing_loss_pct:    (item as { packing_loss_pct?:    number | null }).packing_loss_pct    ?? null,
              open_pack_pct:       (item as { open_pack_pct?:       number | null }).open_pack_pct       ?? null,
              giveaway_pct:        (item as { giveaway_pct?:        number | null }).giveaway_pct        ?? null,
            }}
            buffers={buffersRow ? {
              production_loss_pct: Number(buffersRow.production_loss_pct ?? 0),
              cooking_loss_pct:    Number(buffersRow.cooking_loss_pct    ?? 0),
              packing_loss_pct:    Number(buffersRow.packing_loss_pct    ?? 0),
              open_pack_pct:       Number(buffersRow.open_pack_pct       ?? 0),
              giveaway_pct:        Number(buffersRow.giveaway_pct        ?? 0),
              depreciation_pct:    Number(buffersRow.depreciation_pct    ?? 0),
              sample_pct:          Number(buffersRow.sample_pct          ?? 0),
              product_dev_pct:     Number(buffersRow.product_dev_pct     ?? 0),
              error_pct:           Number(buffersRow.error_pct           ?? 0),
              target_margin_pct:   Number(buffersRow.target_margin_pct   ?? 0),
            } : null}
          />
            {consumerFamilyItems.length > 0 && (
              <FamilyContextStrip
                variant="consumers"
                label="Used in"
                hint={`This item is a component of ${consumerFamilyItems.length === 1 ? "1 product's" : `${consumerFamilyItems.length} products'`} active BOM — see what it feeds into`}
                items={consumerFamilyItems}
              />
            )}
            {(() => {
              // Pricing matrix — only renders for items that can plausibly
              // be sold (FG / WIP). Loaded cost reuses the same compute as
              // CostSummaryCard so the margin chips reconcile.
              const buildup = computeBuildup({
                rm:       Number(bd.totals.rm ?? 0),
                labour:   Number(bd.totals.labour ?? 0),
                overhead: Number(bd.totals.overhead ?? 0),
                stages:   bd.stages ?? [],
                itemLosses: {
                  production_loss_pct: (item as { production_loss_pct?: number | null }).production_loss_pct ?? null,
                  cooking_loss_pct:    (item as { cooking_loss_pct?:    number | null }).cooking_loss_pct    ?? null,
                  packing_loss_pct:    (item as { packing_loss_pct?:    number | null }).packing_loss_pct    ?? null,
                  open_pack_pct:       (item as { open_pack_pct?:       number | null }).open_pack_pct       ?? null,
                  giveaway_pct:        (item as { giveaway_pct?:        number | null }).giveaway_pct        ?? null,
                },
                buffers: buffersRow ? {
                  production_loss_pct: Number(buffersRow.production_loss_pct ?? 0),
                  cooking_loss_pct:    Number(buffersRow.cooking_loss_pct    ?? 0),
                  packing_loss_pct:    Number(buffersRow.packing_loss_pct    ?? 0),
                  open_pack_pct:       Number(buffersRow.open_pack_pct       ?? 0),
                  giveaway_pct:        Number(buffersRow.giveaway_pct        ?? 0),
                  depreciation_pct:    Number(buffersRow.depreciation_pct    ?? 0),
                  sample_pct:          Number(buffersRow.sample_pct          ?? 0),
                  product_dev_pct:     Number(buffersRow.product_dev_pct     ?? 0),
                  error_pct:           Number(buffersRow.error_pct           ?? 0),
                  target_margin_pct:   Number(buffersRow.target_margin_pct   ?? 0),
                } : null,
              });
              const itemPack: ItemPackInfo = {
                default_sell_uom: (item as { default_sell_uom?: ItemPackInfo["default_sell_uom"] }).default_sell_uom ?? null,
                target_weight_g:  (item as { target_weight_g?: number | null }).target_weight_g  ?? null,
                fill_weight_g:    (item as { fill_weight_g?:   number | null }).fill_weight_g    ?? null,
                units_per_inner:  (item as { units_per_inner?: number | null }).units_per_inner  ?? null,
                units_per_outer:  (item as { units_per_outer?: number | null }).units_per_outer  ?? null,
                units_per_pallet: (item as { units_per_pallet?: number | null }).units_per_pallet ?? null,
                weight_mode:      (item as { weight_mode?: string | null }).weight_mode ?? null,
              };
              // Direct cost = COGS compounded through DIRECT losses only
              // (production, cooking, packing, open-pack, giveaway).
              // We approximate this as buildup.postLoss — which is exactly that.
              return (
                <PricingMatrix
                  itemId={item.id}
                  itemName={item.name}
                  itemPack={itemPack}
                  priceGroups={(priceGroupsRows ?? []) as PriceGroupRow[]}
                  existingLines={(priceLinesRows ?? []) as PriceLine[]}
                  loadedCostPerKg={buildup.loadedCost > 0 ? buildup.loadedCost : null}
                  rbpPerKg={buildup.minSell > 0 ? buildup.minSell : null}
                  directCostPerKg={buildup.postLoss > 0 ? buildup.postLoss : null}
                />
              );
            })()}
          </>
        );
      })()}

      {/* ─── Row 1: All Item Details (left) + Hero image (right) ─────────
            The left card now consolidates EVERY at-a-glance attribute the
            operator needs — type/category, procurement, machine/room,
            weight mode, target weights, packaging hierarchy. The Hero
            image sits to the right with the four packaging-image slots
            stacked under it (Product / Inner / Outer / Pallet).
            The Stock card has graduated to the strip above; Used In + the
            Product Tree are in Row 2 next to the BOM. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1.2fr)", gap: "1rem" }}>
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Item Details</h2>
          {/* Two-column grid so the card uses its width instead of leaving
              half the card empty (which was the Item Master complaint). */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 1.5rem" }}>
            {[
              ["Type", ITEM_TYPE_LABELS[item.item_type as ItemType] ?? item.item_type],
              ...(item.item_category ? [["Category", (item.item_category as { name: string }).name]] : [["Category", "—"]]),
              ...(item.item_subcategory ? [["Subcategory", (item.item_subcategory as { name: string }).name]] : [["Subcategory", "—"]]),
              ["Department", item.department || "—"],
              ["Stock / Consume UOM", item.unit],
              ["Weight mode", item.weight_mode === "fixed" ? "Fixed weight" : item.weight_mode === "random" ? "Random weight" : "—"],
              ["Procurement", item.procurement_type === "produce" ? "Produced in-house" : "Purchased"],
              ["Production method", item.production_method ? PRODUCTION_METHOD_LABELS[item.production_method as ProductionMethod] : "—"],
              ["Machine", item.machine || "—"],
              ["Room", item.room || "—"],
              ["Default batch", item.default_batch_size ? `${item.default_batch_size} ${item.batch_unit}` : "—"],
              ["Make to order", item.is_make_to_order ? "Yes" : "No"],
              ["Priority", String(item.priority)],
              // Packaging attributes — pulled forward into Item Details so
              // the lower Packaging card can drop down to images-only.
              ["Target weight per piece", item.target_weight_g != null
                ? `${Number(item.target_weight_g).toFixed(2)} g/pc`
                : (item.spec_weight_per_unit || "—")],
              ["Target weight per inner (auto)", (() => {
                if (item.target_weight_g == null) return "—";
                const upi = item.units_per_inner && item.units_per_inner > 0 ? item.units_per_inner : 1;
                const perInner = Number(item.target_weight_g) * upi;
                return `${perInner.toFixed(2)} g${upi > 1 ? ` (${item.target_weight_g} g/pc × ${upi})` : ""}`;
              })()],
              ["Fill weight per piece", item.fill_weight_g != null ? `${Number(item.fill_weight_g).toFixed(2)} g` : "—"],
              ["Process loss", item.process_loss_pct != null ? `${Number(item.process_loss_pct).toFixed(2)} %` : "—"],
              ["Pieces per inner", item.units_per_inner ?? "—"],
              ["Inners per outer", item.inner_per_outer ?? "—"],
              ["Outers per pallet", item.outers_per_pallet ?? "—"],
              ["Pieces per outer (auto)", item.units_per_outer ?? "—"],
              ["Pieces per pallet (auto)", item.units_per_pallet ?? unitsPerPallet ?? "—"],
              ["TI × HI", (ti != null && hi != null) ? `${ti} × ${hi}` : "—"],
              ["Pallet type", palletConfig?.pallet_type ?? "—"],
              ...(item.weight_mode === "fixed" ? [
                ["Tolerance", `+${Math.round(item.tolerance_over_g ?? 0)} g / −${Math.round(item.tolerance_under_g ?? 0)} g`],
                ["Tare", item.tare_weight_g != null ? `${Math.round(item.tare_weight_g)} g` : "—"],
              ] : []),
              ["Giveaway", item.giveaway_pct != null
                ? `${Number(item.giveaway_pct).toFixed(2)}%${item.target_weight_g ? ` (≈ ${Math.round((item.giveaway_pct * item.target_weight_g) / 100)} g/pc)` : ""}`
                : "—"],
              ["Shelf life from manufacture", item.spec_shelf_life || "—"],
              ["Min shelf life on dispatch", item.min_shelf_life_days ? `${item.min_shelf_life_days} days` : "—"],
            ].map(([k, v], i) => (
              <div
                key={k as string}
                style={{
                  padding: "0.4rem 0",
                  borderBottom: "1px solid #f5f5f4",
                  display: "flex", justifyContent: "space-between", gap: "0.75rem",
                  alignItems: "baseline",
                  fontSize: "0.8125rem",
                  // Visual rhythm: alternate rows lightly tinted so the
                  // 25-row grid stays scannable across two columns.
                  background: i % 2 === 0 ? "transparent" : "transparent",
                }}
              >
                <span style={{ color: "#78716c" }}>{k}</span>
                <span style={{ color: "#292524", fontWeight: 500, textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right column — hero image plus the 4 packaging-image slots
            stacked under it (moved from the bottom of the Packaging card
            so they're adjacent to the hero, not floating in white space). */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{
              aspectRatio: "1",
              background: "#fafaf9",
              display: "flex", alignItems: "center", justifyContent: "center",
              position: "relative",
            }}>
              {slotImages.product?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={slotImages.product.url}
                  alt={item.name}
                  style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                />
              ) : (
                <div style={{ textAlign: "center", color: "#a8a29e", padding: "0.75rem" }}>
                  <div style={{ fontSize: "1.75rem" }}>🥩</div>
                  <div style={{ fontSize: "0.7rem", marginTop: "0.25rem" }}>No product image</div>
                  <div style={{ fontSize: "0.65rem", color: "#a8a29e", marginTop: "0.125rem" }}>
                    Tag an image as &ldquo;Product&rdquo; below
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Inner / Outer / Pallet preview strip — compact, sits right
              under the hero so packaging context lives together. */}
          <div className="card" style={{ padding: "0.625rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.4rem" }}>
              {IMAGE_SLOTS.filter(s => s.key !== "product").map(slot => {
                const img = slotImages[slot.key];
                return (
                  <div key={slot.key}>
                    <div style={{
                      aspectRatio: "1", background: "#fafaf9", border: "1px solid #e7e5e4",
                      borderRadius: "0.375rem", overflow: "hidden",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {img?.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img.url} alt={slot.label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ fontSize: "1.1rem", color: "#a8a29e" }}>{slot.emoji}</div>
                      )}
                    </div>
                    <div style={{ marginTop: "0.2rem", textAlign: "center", fontSize: "0.6rem", fontWeight: 600, color: "#57534e", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {slot.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Row 2: BOMs (left, where Packaging used to sit) +
            Used-In / Product Tree (right) ─────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: "1rem", marginTop: "1.5rem" }}>
        {/* BOM card — promoted into the prime real estate. Was previously
            the last block on the page; floor and planner staff use this
            way more than spec docs / micro panel. The card is a client
            component (BomCard) so the operator gets click-to-sort columns
            and drag-to-resize widths persisted in localStorage. */}
        {boms && boms.length > 0 ? (
          <BomCard
            itemId={id}
            boms={(boms as Parameters<typeof BomCard>[0]["boms"])}
            newVersionTrigger={
              <BomFormModal defaultItemId={id} triggerLabel="+ New Version" triggerClassName="btn-primary" />
            }
          />
        ) : (
          <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "2rem", textAlign: "center", color: "#78716c" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📋</div>
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.5rem" }}>No BOM yet</h2>
            <p style={{ fontSize: "0.8125rem", margin: "0 0 1rem" }}>
              Define the recipe for this item to enable MRP and consumption tracking.
            </p>
            <BomFormModal defaultItemId={id} triggerLabel="+ Create BOM" triggerClassName="btn-primary" />
          </div>
        )}

        {/* Right column: Used In + Product Tree */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 }}>
          {usedInItems.length > 0 && (
            <div className="card">
              <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.75rem" }}>Used In (BOMs)</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                {usedInItems.map((u: any) => u && (
                  <Link key={u.id} href={`/items/${u.id}`} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.625rem", background: "#fafaf9", borderRadius: "0.375rem", border: "1px solid #e7e5e4" }}>
                    <span className={`badge ${ITEM_TYPE_COLORS[u.item_type as ItemType]}`} style={{ fontSize: "0.625rem" }}>{u.item_type.toUpperCase().replace("_", " ")}</span>
                    <span style={{ fontSize: "0.8125rem", fontWeight: "500", color: "#1c1917" }}>{u.code} — {u.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          <ProductTreeCard
            items={treeItems}
            currentId={id}
            canEdit={canEditTree}
          />
        </div>
      </div>

      {/* (Packaging numbers consolidated into Item Details above; the
          packaging-image strip lives next to the hero in Row 1.) */}

      {/* ─── Product Specification ─────────────────────────── */}
      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Product Specification</h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
          {/* Left: descriptive */}
          <div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {[
                  ["Storage temperature", item.spec_storage_temp || "—"],
                  ["Origin / Source",     item.spec_origin       || "—"],
                  ["Fat content",         item.spec_fat_content  || "—"],
                  ["Protein",             item.spec_protein      || "—"],
                  ["Moisture",            item.spec_moisture     || "—"],
                  ["pH",                  item.spec_ph           || "—"],
                  ["Water activity",      item.spec_water_activity || "—"],
                  ["Packaging",           item.spec_packaging    || "—"],
                  ["Labelling",           item.spec_labelling    || "—"],
                  ["Ready to Eat (RTE)",  item.is_rte ? "Yes" : "No"],
                ].map(([k, v]) => (
                  <tr key={k as string} style={{ borderBottom: "1px solid #f5f5f4" }}>
                    <td style={{ padding: "0.4375rem 0", fontSize: "0.8125rem", color: "#78716c", width: "45%" }}>{k}</td>
                    <td style={{ padding: "0.4375rem 0", fontSize: "0.875rem", color: "#292524", fontWeight: "500" }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Ingredients statement */}
            <div style={{ marginTop: "0.875rem" }}>
              <div style={{ fontSize: "0.75rem", color: "#78716c", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                Ingredients statement
              </div>
              <div style={{ padding: "0.625rem 0.75rem", background: "#fafaf9", borderRadius: "0.375rem",
                            fontSize: "0.875rem", color: item.ingredients_statement ? "#292524" : "#a8a29e",
                            lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                {item.ingredients_statement || "Not set"}
              </div>
            </div>

            {/* Allergens */}
            <div style={{ marginTop: "0.875rem" }}>
              <div style={{ fontSize: "0.75rem", color: "#78716c", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                Allergen statement
              </div>
              {(item.allergens?.length ?? 0) > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                  {[...new Set((item.allergens as string[]).map((a: string) => a.replace(/^[A-Z]+_/, "")))]
                    .map((a) => <span key={a} className="badge badge-yellow" style={{ fontSize: "0.6875rem" }}>{a}</span>)}
                </div>
              ) : (
                <div style={{ fontSize: "0.875rem", color: "#a8a29e" }}>No allergens declared</div>
              )}
            </div>

            {item.spec_notes && (
              <div style={{ marginTop: "0.875rem", padding: "0.625rem 0.75rem", background: "#fafaf9", borderRadius: "0.375rem", fontSize: "0.875rem", color: "#78716c" }}>
                <strong>Notes:</strong> {item.spec_notes}
              </div>
            )}
          </div>

          {/* Right: NIP (per 100g + per serve) */}
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.625rem" }}>
              Nutrition Information Panel
              {item.nut_per_serving_g ? <span style={{ color: "#78716c", fontWeight: 400, marginLeft: "0.5rem" }}>· serving size {item.nut_per_serving_g} g</span> : null}
            </div>
            {item.nut_energy_kj == null ? (
              <div style={{ padding: "0.625rem 0.75rem", background: "#fafaf9", borderRadius: "0.375rem", fontSize: "0.875rem", color: "#a8a29e" }}>
                Nutrition not yet entered
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #1c1917" }}>
                    <th style={{ textAlign: "left",  padding: "0.375rem 0.5rem", color: "#1c1917", fontWeight: 600 }}>Description</th>
                    <th style={{ textAlign: "right", padding: "0.375rem 0.5rem", color: "#1c1917", fontWeight: 600 }}>Per Serve {item.nut_per_serving_g ? `(${item.nut_per_serving_g} g)` : ""}</th>
                    <th style={{ textAlign: "right", padding: "0.375rem 0.5rem", color: "#1c1917", fontWeight: 600 }}>Per 100 g</th>
                  </tr>
                </thead>
                <tbody>
                  {nutritionRows(item).map(([label, per100, perServe]) => (
                    <tr key={label} style={{ borderBottom: "1px solid #f5f5f4" }}>
                      <td style={{ padding: "0.4rem 0.5rem" }}>{label}</td>
                      <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#57534e" }}>{perServe}</td>
                      <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{per100}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {item.nut_notes && (
              <div style={{ marginTop: "0.625rem", padding: "0.5rem 0.75rem", background: "#fafaf9", borderRadius: "0.375rem", fontSize: "0.8125rem", color: "#78716c" }}>
                {item.nut_notes}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Microbiological (table) ─────────────────────── */}
      <MicroPanel item={item} />

      {/* ─── Customer Documents (GB Spec / PIF / Other) ──── */}
      <div className="card" style={{ marginTop: "1.5rem", padding: 0 }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Customer Documents</h2>
          <Link href={`/specs/new?item_id=${id}`} className="btn-primary" style={{ fontSize: "0.8125rem" }}>+ New GB Spec</Link>
        </div>

        {/* GB Specs */}
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #f5f5f4" }}>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, margin: "0 0 0.625rem" }}>GB Specification</h3>
          {productSpecs && productSpecs.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              {productSpecs.map(ps => (
                <div key={ps.id} style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0.625rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.375rem" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>v{ps.version_label}</span>
                  <span style={{
                    padding: "0.1rem 0.45rem", borderRadius: "9999px", fontSize: "0.65rem", fontWeight: 600,
                    background: ps.status === "approved" ? "#dcfce7" : "#fef9c3",
                    color:      ps.status === "approved" ? "#166534" : "#854d0e",
                  }}>{ps.status === "approved" ? "✓ Approved" : "Draft"}</span>
                  <span style={{ color: "#78716c", fontSize: "0.75rem" }}>
                    {new Date(ps.updated_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                  <span style={{ flex: 1 }} />
                  <Link href={`/specs/${ps.id}/preview`} className="btn-secondary" style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}>Preview</Link>
                  <Link href={`/specs/${ps.id}`} className="btn-secondary" style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}>Edit</Link>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: "0.8125rem", color: "#a8a29e" }}>
              No GB specs yet. <Link href={`/specs/new?item_id=${id}`} style={{ color: "#b91c1c", textDecoration: "none", fontWeight: 600 }}>Create one →</Link>
            </div>
          )}
        </div>

        {/* PIFs */}
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #f5f5f4" }}>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, margin: "0 0 0.625rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            Product Information Form (PIF)
            <span style={{ fontSize: "0.7rem", color: "#78716c", fontWeight: 400 }}>
              {isRawOrPackaging ? "(supplier-supplied PDF)" : "(generated from GB spec)"}
            </span>
          </h3>
          {isRawOrPackaging ? (
            pifDocs.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                {pifDocs.map(d => (
                  <div key={d.id} style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0.625rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.375rem" }}>
                    <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>{d.title}</span>
                    {d.version && <span style={{ color: "#78716c", fontSize: "0.75rem" }}>v{d.version}</span>}
                    {d.supplier && <span style={{ color: "#78716c", fontSize: "0.75rem" }}>· {d.supplier.name}</span>}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: "0.7rem", color: "#78716c" }}>{(d.document_name || "").split("/").pop()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: "0.8125rem", color: "#a8a29e" }}>
                No PIF uploaded. Add one in the Spec Documents section below (set type = PIF).
              </div>
            )
          ) : productSpecs && productSpecs.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              {productSpecs.map(ps => (
                <div key={ps.id} style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0.625rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.375rem" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>PIF v{ps.version_label}</span>
                  <span style={{
                    padding: "0.1rem 0.45rem", borderRadius: "9999px", fontSize: "0.65rem", fontWeight: 600,
                    background: ps.status === "approved" ? "#dcfce7" : "#fef9c3",
                    color:      ps.status === "approved" ? "#166534" : "#854d0e",
                  }}>{ps.status === "approved" ? "✓ Approved" : "Draft"}</span>
                  <span style={{ flex: 1 }} />
                  <Link href={`/specs/${ps.id}/pif`} className="btn-secondary" style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}>Preview PIF</Link>
                  <Link href={`/specs/${ps.id}/pif?print=1`} className="btn-primary" style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}>Download PDF</Link>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: "0.8125rem", color: "#a8a29e" }}>
              Create a GB Spec first — the PIF is generated from it.
            </div>
          )}
        </div>

        {/* Other / customer-supplied docs */}
        <div style={{ padding: "1rem 1.25rem" }}>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, margin: "0 0 0.625rem" }}>Customer / 3rd-party specifications</h3>
          {customerDocs.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              {customerDocs.slice(0, 5).map(d => (
                <div key={d.id} style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0.625rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.375rem" }}>
                  <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>{d.title}</span>
                  <span style={{ fontSize: "0.7rem", color: "#78716c", padding: "0.1rem 0.4rem", background: "#e7e5e4", borderRadius: "0.25rem" }}>{d.document_type}</span>
                  {d.supplier && <span style={{ color: "#78716c", fontSize: "0.75rem" }}>· {d.supplier.name}</span>}
                </div>
              ))}
              {customerDocs.length > 5 && (
                <div style={{ fontSize: "0.75rem", color: "#78716c" }}>+ {customerDocs.length - 5} more in the Spec Documents section below</div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: "0.8125rem", color: "#a8a29e" }}>None uploaded.</div>
          )}
        </div>
      </div>

      {/* (Product Images uploader removed from view — manage images via Edit Item) */}

      {/* ─── Supplier Specifications (per-supplier preview panel) ─────────
          Read-focused view showing every spec doc supplied by each
          supplier for this item, with a 👁 Preview button. Specs without
          a supplier_id (GB-internal) live in the bigger "Spec Documents"
          panel below. */}
      <div style={{ marginTop: "1.5rem" }}>
        <ItemSupplierSpecsPanel
          docs={(specDocs ?? []) as Parameters<typeof ItemSupplierSpecsPanel>[0]["docs"]}
          supplierLinks={(supplierLinks ?? []) as Parameters<typeof ItemSupplierSpecsPanel>[0]["supplierLinks"]}
        />
      </div>

      {/* ─── Ingredient composition (Phase 3H.3) ─────────── */}
      {tenantId && (
        <div style={{ marginTop: "1.5rem" }}>
          <ItemComponentsPanel itemId={id} tenantId={tenantId} />
        </div>
      )}

      {/* ─── Spec Documents (full panel) ─────────────────── */}
      {tenantId && (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <ItemSpecDocsPanel
            itemId={id}
            tenantId={tenantId}
            docs={(specDocs ?? []) as Parameters<typeof ItemSpecDocsPanel>[0]["docs"]}
            suppliers={suppliers ?? []}
            itemType={item.item_type}
          />
        </div>
      )}

      {/* ─── Suppliers ───────────────────────────────────── */}
      {tenantId && (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <ItemSuppliersPanel
            itemId={id}
            itemUnit={item.unit ?? "kg"}
            initialSuppliers={(supplierLinks ?? []) as Parameters<typeof ItemSuppliersPanel>[0]["initialSuppliers"]}
            allSuppliers={suppliers ?? []}
            specDocs={(specDocs ?? []) as Parameters<typeof ItemSuppliersPanel>[0]["specDocs"]}
            tenantId={tenantId}
          />
        </div>
      )}

      {/* (BOMs section was duplicated here — now lives in Row 2 above
          alongside Used-In and the Product Tree. Kept the comment so
          future-me doesn't paste it back in by mistake.) */}

    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────

function nutritionRows(item: any): [string, string, string][] {
  const ps = item.nut_per_serving_g ? Number(item.nut_per_serving_g) : null;
  const fmt = (per100: number | null | undefined, unit: string): [string, string] => {
    if (per100 == null) return ["—", "—"];
    const per100s = `${(+per100).toFixed(1)}${unit}`;
    const perServeS = ps != null ? `${((+per100 * ps) / 100).toFixed(1)}${unit}` : "—";
    return [per100s, perServeS];
  };
  const fmtEnergy = (kj: number | null | undefined, kcal: number | null | undefined): [string, string] => {
    if (kj == null && kcal == null) return ["—", "—"];
    const kjStr   = kj   != null ? `${(+kj).toFixed(0)} kJ`   : "—";
    const kcalStr = kcal != null ? `${(+kcal).toFixed(0)} kcal` : "—";
    const per100s = `${kjStr} / ${kcalStr}`;
    if (ps == null) return [per100s, "—"];
    const sj   = kj   != null ? `${((+kj   * ps) / 100).toFixed(0)} kJ`   : "—";
    const sk   = kcal != null ? `${((+kcal * ps) / 100).toFixed(0)} kcal` : "—";
    return [per100s, `${sj} / ${sk}`];
  };
  const e = fmtEnergy(item.nut_energy_kj, item.nut_energy_kcal);
  return [
    ["Energy",          e[0], e[1]],
    ["Protein",         ...fmt(item.nut_protein_g,       "g")],
    ["Fat — total",     ...fmt(item.nut_fat_total_g,     "g")],
    ["Fat — saturated", ...fmt(item.nut_fat_saturated_g, "g")],
    ["Carbohydrates",   ...fmt(item.nut_carbs_total_g,   "g")],
    ["— sugars",        ...fmt(item.nut_carbs_sugars_g,  "g")],
    ["Dietary fibre",   ...fmt(item.nut_fibre_g,         "g")],
    ["Sodium",          ...fmt(item.nut_sodium_mg,       "mg")],
  ];
}
// ─── Product Tree moved to src/components/product-tree.tsx (now drag-and-drop). ───

// ─── Micro Panel ───────────────────────────────────────────

const MICRO_TESTS_DETAIL: { key: string; label: string }[] = [
  { key: "micro_tpc",                 label: "Total Plate Count (TPC)" },
  { key: "micro_ecoli",               label: "E. coli" },
  { key: "micro_coliforms",           label: "Coliforms" },
  { key: "micro_salmonella",          label: "Salmonella" },
  { key: "micro_listeria",            label: "Listeria monocytogenes" },
  { key: "micro_s_aureus",            label: "Staphylococcus aureus" },
  { key: "micro_yeast_mould",         label: "Yeasts & moulds" },
  { key: "micro_sulphite_clostridia", label: "Sulphite-reducing clostridia" },
];

function MicroPanel({ item }: { item: any }) {
  const set = MICRO_TESTS_DETAIL.filter(t => item[t.key]);
  // Show the panel even if no structured limits are set, but only if there's a
  // legacy spec_micro free-text value to display.
  if (set.length === 0 && !item.spec_micro && !item.micro_reference) return null;

  return (
    <div className="card" style={{ marginTop: "1.5rem", padding: 0 }}>
      <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>Microbiological</h2>
        {item.micro_reference && (
          <span style={{ fontSize: "0.75rem", color: "#78716c" }}>
            Reference: <strong style={{ color: "#1c1917" }}>{item.micro_reference}</strong>
          </span>
        )}
      </div>
      <div style={{ padding: "0.75rem 1.25rem" }}>
        {set.length > 0 ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e7e5e4" }}>
                <th style={{ textAlign: "left", padding: "0.5rem 0.75rem 0.5rem 0", fontSize: "0.75rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Test
                </th>
                <th style={{ textAlign: "left", padding: "0.5rem 0", fontSize: "0.75rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Limit
                </th>
              </tr>
            </thead>
            <tbody>
              {set.map(t => (
                <tr key={t.key} style={{ borderBottom: "1px solid #f5f5f4" }}>
                  <td style={{ padding: "0.5rem 0.75rem 0.5rem 0", fontSize: "0.875rem", color: "#1c1917" }}>{t.label}</td>
                  <td style={{ padding: "0.5rem 0", fontSize: "0.875rem", fontFamily: "ui-monospace, monospace", color: "#57534e" }}>
                    {item[t.key]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      {item.spec_micro && (
          <div style={{ marginTop: set.length > 0 ? "0.75rem" : 0, padding: "0.625rem 0.75rem", background: "#fafaf9", borderRadius: "0.375rem", fontSize: "0.8125rem", color: "#57534e", whiteSpace: "pre-wrap" }}>
            {item.spec_micro}
          </div>
        )}
      </div>
    </div>
  );
}
