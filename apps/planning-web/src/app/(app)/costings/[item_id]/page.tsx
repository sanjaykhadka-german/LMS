import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackButton } from "@/components/back-button";
import { ITEM_TYPE_LABELS, ITEM_TYPE_COLORS, type ItemType } from "@/lib/types";
import BreakdownContent, {
  type Stage, type CostCentre, type OverheadInfo, type Buffers, type ItemLosses,
} from "./_components/breakdown-content";

/**
 * /costings/[item_id] — per-product cost sheet (v2: stacked stages).
 *
 * Calls cost_breakdown_v2 RPC which returns the breakdown grouped by BOM
 * stage (FG → WIPP → WIPF → WIP). Each stage card shows direct RM at
 * that level + labour at that level + subtotal. Cost-centre chip strip
 * at the top sums labour by department across all stages. Pricing
 * section at the bottom walks COGS → +buffers → loaded → +margin =
 * MINIMUM SELL PRICE.
 *
 * Every line links to its source (item edit / BOM routing) so an audit
 * pass goes: spot bad number → click → fix → return → refresh.
 */

export const dynamic = "force-dynamic";

export default async function CostBreakdownPage({ params }: { params: Promise<{ item_id: string }> }) {
  const { item_id } = await params;
  const supabase = await createClient();

  const [bdRes, buffersRes] = await Promise.all([
    supabase.rpc("cost_breakdown_v2", { p_item_id: item_id }),
    supabase
      .from("v_pricing_buffers_current")
      .select("production_loss_pct, depreciation_pct, sample_pct, product_dev_pct, error_pct, target_margin_pct, effective_from")
      .maybeSingle(),
  ]);

  if (bdRes.error || !bdRes.data) notFound();
  const bd = bdRes.data as {
    item: {
      id: string; code: string; name: string; item_type: string; unit: string;
      production_loss_pct: number | string | null;
      cooking_loss_pct:    number | string | null;
      packing_loss_pct:    number | string | null;
      open_pack_pct:       number | string | null;
      giveaway_pct:        number | string | null;
    };
    totals: { rm: number | string; labour: number | string; overhead: number | string; total: number | string };
    cost_centres: Array<{ centre: string; amount: number | string }>;
    stages: Stage[];
    overhead: OverheadInfo | null;
  };

  const totals = {
    rm:       Number(bd.totals.rm),
    labour:   Number(bd.totals.labour),
    overhead: Number(bd.totals.overhead),
    total:    Number(bd.totals.total),
  };

  const costCentres: CostCentre[] = (bd.cost_centres ?? []).map(c => ({
    centre: c.centre,
    amount: Number(c.amount),
  }));

  const buffersRow = buffersRes.data as
    | (Record<string, number | string | null> & { effective_from?: string | null })
    | null;
  const buffers: Buffers | null = buffersRow ? {
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
    effective_from:      buffersRow.effective_from ?? null,
  } : null;

  const itemLosses: ItemLosses = {
    production_loss_pct: bd.item.production_loss_pct != null ? Number(bd.item.production_loss_pct) : null,
    cooking_loss_pct:    bd.item.cooking_loss_pct    != null ? Number(bd.item.cooking_loss_pct)    : null,
    packing_loss_pct:    bd.item.packing_loss_pct    != null ? Number(bd.item.packing_loss_pct)    : null,
    open_pack_pct:       bd.item.open_pack_pct       != null ? Number(bd.item.open_pack_pct)       : null,
    giveaway_pct:        bd.item.giveaway_pct        != null ? Number(bd.item.giveaway_pct)        : null,
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <BackButton href="/costings" label="Costings" />
            <span style={{ color: "#78716c", fontSize: "0.875rem" }}>·</span>
            <Link href={`/items/${bd.item.id}`} style={{ color: "#b91c1c", textDecoration: "none", fontSize: "0.8125rem", fontWeight: 500 }}>
              {bd.item.code} — Item Master
            </Link>
          </div>
          <h1 className="page-title" style={{ marginTop: "0.375rem" }}>
            Cost sheet — {bd.item.name}
          </h1>
          <div style={{ marginTop: "0.375rem" }}>
            <span className={`badge ${ITEM_TYPE_COLORS[bd.item.item_type as ItemType] ?? "badge-gray"}`}>
              {ITEM_TYPE_LABELS[bd.item.item_type as ItemType] ?? bd.item.item_type}
            </span>
          </div>
        </div>
      </div>

      <BreakdownContent
        itemName={bd.item.name}
        itemUnit={bd.item.unit}
        itemType={bd.item.item_type}
        totals={totals}
        costCentres={costCentres}
        stages={bd.stages}
        overhead={bd.overhead}
        buffers={buffers}
        itemLosses={itemLosses}
      />
    </div>
  );
}
