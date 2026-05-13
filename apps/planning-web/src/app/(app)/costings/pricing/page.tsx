import { createClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/tenant";
import PricingBuffersEditor, { type BufferHistoryRow } from "./_components/pricing-buffers-editor";

/**
 * /costings/pricing — tenant-wide pricing buffer percentages.
 *
 * Applied on top of COGS (RM + Labour + OH) to arrive at the minimum sell
 * price. Six percentages: production loss, depreciation, sample, product
 * development, error margin, target gross margin.
 *
 * The breakdown page (/costings/[item_id]) walks COGS → +buffers →
 * loaded cost → ÷(1 - margin%) → MINIMUM SELL PRICE.
 */

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const supabase = await createClient();
  const tenantId = await getTenantId();

  const currentP = supabase
    .from("v_pricing_buffers_current")
    .select("production_loss_pct, cooking_loss_pct, packing_loss_pct, open_pack_pct, giveaway_pct, depreciation_pct, sample_pct, product_dev_pct, error_pct, target_margin_pct, effective_from, notes")
    .maybeSingle();

  const histP = supabase
    .from("pricing_buffers")
    .select("id, effective_from, production_loss_pct, cooking_loss_pct, packing_loss_pct, open_pack_pct, giveaway_pct, depreciation_pct, sample_pct, product_dev_pct, error_pct, target_margin_pct, notes")
    .eq("tenant_id", tenantId ?? "")
    .order("effective_from", { ascending: false });

  const [{ data: current }, { data: hist }] = await Promise.all([currentP, histP]);

  const history: BufferHistoryRow[] = ((hist ?? []) as Array<{
    id: string; effective_from: string;
    production_loss_pct: number | string;
    cooking_loss_pct: number | string;
    packing_loss_pct: number | string;
    open_pack_pct: number | string;
    giveaway_pct: number | string;
    depreciation_pct: number | string;
    sample_pct: number | string;
    product_dev_pct: number | string;
    error_pct: number | string;
    target_margin_pct: number | string;
    notes: string | null;
  }>).map(h => ({
    id: h.id,
    effective_from: h.effective_from,
    production_loss_pct: Number(h.production_loss_pct ?? 0),
    cooking_loss_pct:    Number(h.cooking_loss_pct ?? 0),
    packing_loss_pct:    Number(h.packing_loss_pct ?? 0),
    open_pack_pct:       Number(h.open_pack_pct ?? 0),
    giveaway_pct:        Number(h.giveaway_pct ?? 0),
    depreciation_pct:    Number(h.depreciation_pct ?? 0),
    sample_pct:          Number(h.sample_pct ?? 0),
    product_dev_pct:     Number(h.product_dev_pct ?? 0),
    error_pct:           Number(h.error_pct ?? 0),
    target_margin_pct:   Number(h.target_margin_pct ?? 0),
    notes: h.notes ?? "",
  }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">💵 Pricing buffers</h1>
          <p className="page-subtitle">
            Percentages added on top of COGS (RM + Labour + Overhead) to
            arrive at the minimum sell price — the floor below which no
            product is sold. Tenant-wide for now; per-item overrides come
            later if needed.
          </p>
        </div>
      </div>

      <PricingBuffersEditor
        current={current ? {
          production_loss_pct: Number(current.production_loss_pct ?? 0),
          cooking_loss_pct:    Number(current.cooking_loss_pct ?? 0),
          packing_loss_pct:    Number(current.packing_loss_pct ?? 0),
          open_pack_pct:       Number(current.open_pack_pct ?? 0),
          giveaway_pct:        Number(current.giveaway_pct ?? 0),
          depreciation_pct:    Number(current.depreciation_pct ?? 0),
          sample_pct:          Number(current.sample_pct ?? 0),
          product_dev_pct:     Number(current.product_dev_pct ?? 0),
          error_pct:           Number(current.error_pct ?? 0),
          target_margin_pct:   Number(current.target_margin_pct ?? 0),
          notes:               current.notes ?? "",
          effective_from:      current.effective_from ?? null,
        } : null}
        history={history}
      />
    </div>
  );
}
