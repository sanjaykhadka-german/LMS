/**
 * Shared loaded-cost math — used by both CostSummaryCard (admin view on
 * the item master) and PricingMatrix (per-group prices) so the two cards
 * never drift apart.
 *
 * The math:
 *   COGS = RM + Labour + Overhead
 *   loss-compounded = COGS / Π(1 - loss_i/100)         (production, cooking, packing, open-pack, giveaway)
 *   markup = post-loss × Σ markup_i/100                 (depreciation, samples, R&D, error)
 *   Loaded cost = post-loss + markup
 *
 * Each loss is walked through the cascade: preferred stage first
 * (production at WIP/WIPF, cooking at WIPF with process_loss fallback,
 * packing at WIPP, etc.), then any stage > 0, then the item's own column,
 * then the tenant default.
 */

export type StageLossInfo = {
  node_type: string;
  node_code: string;
  losses: {
    production_loss_pct: number | string | null;
    cooking_loss_pct:    number | string | null;
    packing_loss_pct:    number | string | null;
    open_pack_pct:       number | string | null;
    giveaway_pct:        number | string | null;
    process_loss_pct:    number | string | null;
  };
};

export type Buffers = {
  production_loss_pct: number;
  cooking_loss_pct: number;
  packing_loss_pct: number;
  open_pack_pct: number;
  giveaway_pct: number;
  depreciation_pct: number;
  sample_pct: number;
  product_dev_pct: number;
  error_pct: number;
  target_margin_pct: number;
};

export type ItemLosses = {
  production_loss_pct: number | null;
  cooking_loss_pct: number | null;
  packing_loss_pct: number | null;
  open_pack_pct: number | null;
  giveaway_pct: number | null;
};

type LossKey = "production_loss_pct" | "cooking_loss_pct" | "packing_loss_pct" | "open_pack_pct" | "giveaway_pct";

function isSet(v: number | string | null | undefined): boolean {
  if (v == null) return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

export function lossFromStages(
  stages: StageLossInfo[],
  key: LossKey,
  preferred: string[],
  tenantVal: number,
  rootFallback?: number | null,
): number {
  for (const t of preferred) {
    const st = stages.find(s => s.node_type === t);
    if (st && st.losses && isSet(st.losses[key])) return Number(st.losses[key]);
  }
  for (const st of stages) {
    if (st.losses && isSet(st.losses[key])) return Number(st.losses[key]);
  }
  if (rootFallback != null && rootFallback > 0) return rootFallback;
  return tenantVal > 0 ? tenantVal : 0;
}

export function cookingLossEffective(stages: StageLossInfo[], tenantVal: number): number {
  const wipfStage = stages.find(s => s.node_type === "wipf");
  if (wipfStage?.losses && isSet(wipfStage.losses.cooking_loss_pct)) return Number(wipfStage.losses.cooking_loss_pct);
  for (const st of stages) {
    if (st.losses && isSet(st.losses.cooking_loss_pct)) return Number(st.losses.cooking_loss_pct);
  }
  if (wipfStage?.losses && isSet(wipfStage.losses.process_loss_pct)) return Number(wipfStage.losses.process_loss_pct);
  for (const st of stages) {
    if (st.losses && isSet(st.losses.process_loss_pct)) return Number(st.losses.process_loss_pct);
  }
  return tenantVal > 0 ? tenantVal : 0;
}

function compound(running: number, pct: number): number {
  if (pct <= 0 || pct >= 100) return running;
  return running / (1 - pct / 100);
}

/** Compute the full loaded-cost buildup for an item. Returns COGS through
 *  loaded-cost; min sell is the caller's call (depends on target margin). */
export function computeBuildup(input: {
  rm: number;
  labour: number;
  overhead: number;
  stages: StageLossInfo[];
  itemLosses: ItemLosses;
  buffers: Buffers | null;
}): {
  cogs: number;
  postLoss: number;
  loadedCost: number;
  minSell: number;
} {
  const { rm, labour, overhead, stages, itemLosses, buffers } = input;
  const cogs = rm + labour + overhead;

  const prodLoss = lossFromStages(stages, "production_loss_pct", ["wip", "wipf"],          buffers?.production_loss_pct ?? 0, itemLosses?.production_loss_pct ?? null);
  const cookLoss = cookingLossEffective(stages,                                              buffers?.cooking_loss_pct    ?? 0);
  const packLoss = lossFromStages(stages, "packing_loss_pct",    ["wipp", "wipf"],          buffers?.packing_loss_pct    ?? 0, itemLosses?.packing_loss_pct ?? null);
  const openPack = lossFromStages(stages, "open_pack_pct",       ["finished_good", "wipp"], buffers?.open_pack_pct       ?? 0, itemLosses?.open_pack_pct ?? null);
  const giveaway = lossFromStages(stages, "giveaway_pct",        ["wipp", "finished_good"], buffers?.giveaway_pct        ?? 0, itemLosses?.giveaway_pct ?? null);

  let postLoss = cogs;
  postLoss = compound(postLoss, prodLoss);
  postLoss = compound(postLoss, cookLoss);
  postLoss = compound(postLoss, packLoss);
  postLoss = compound(postLoss, openPack);
  postLoss = compound(postLoss, giveaway);

  const deprAmt   = postLoss * (buffers?.depreciation_pct ?? 0) / 100;
  const sampleAmt = postLoss * (buffers?.sample_pct       ?? 0) / 100;
  const pdevAmt   = postLoss * (buffers?.product_dev_pct  ?? 0) / 100;
  const errorAmt  = postLoss * (buffers?.error_pct        ?? 0) / 100;
  const loadedCost = postLoss + deprAmt + sampleAmt + pdevAmt + errorAmt;

  const marginPct = buffers?.target_margin_pct ?? 0;
  const minSell = (marginPct > 0 && marginPct < 100)
    ? loadedCost / (1 - marginPct / 100)
    : loadedCost;

  return { cogs, postLoss, loadedCost, minSell };
}
