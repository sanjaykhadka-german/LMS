import React from "react";
import Link from "next/link";

/**
 * Read-only cost summary card on the item detail page (/items/[id]).
 *
 * Renders a compact buildup: Direct + Indirect = COGS, +Loss buffers,
 * +Markups, ÷(1−margin) = MIN SELL PRICE. Admin-gated by the caller.
 *
 * Uses the FG/root item's own loss values + tenant defaults (additive,
 * compounded). The full per-stage loss attribution lives on the dedicated
 * /costings/[id] breakdown page — link at the bottom of this card.
 */

type Buffers = {
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

type StageLossInfo = {
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

type LossKey = "production_loss_pct" | "cooking_loss_pct" | "packing_loss_pct" | "open_pack_pct" | "giveaway_pct";

function fmt(v: number, dp = 4): string {
  if (!Number.isFinite(v)) return "—";
  return "$" + v.toLocaleString("en-AU", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// Walk the cascade for a given loss category. Each loss has natural stages
// it belongs to: production at WIP/WIPF, packing at WIPP, open_pack at FG,
// etc. Falls back to the tenant default. Same logic as breakdown-content
// on the cost sheet — keeps the two views in sync. Tino May 2026.
// Treat 0 as not-set so an explicit zero on an early stage doesn't short-
// circuit the walk and hide a real value deeper. Tino May 2026.
function isSet(v: number | string | null | undefined): boolean {
  if (v == null) return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

function lossFromStages(stages: StageLossInfo[], key: LossKey, preferred: string[], tenantVal: number, rootFallback?: number | null): number {
  // 1) Preferred natural-home stages first (only if > 0).
  for (const t of preferred) {
    const st = stages.find(s => s.node_type === t);
    if (st && st.losses && isSet(st.losses[key])) return Number(st.losses[key]);
  }
  // 2) Any stage with a non-zero value.
  for (const st of stages) {
    if (st.losses && isSet(st.losses[key])) return Number(st.losses[key]);
  }
  // 3) Root item's own column when > 0.
  if (rootFallback != null && rootFallback > 0) return rootFallback;
  // 4) Tenant default.
  return tenantVal > 0 ? tenantVal : 0;
}

// Cooking loss: cooking_loss_pct > 0 anywhere (prefer WIPF), then
// process_loss_pct > 0 anywhere (prefer WIPF), then tenant default.
function cookingLossEffective(stages: StageLossInfo[], tenantVal: number): number {
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

export default function CostSummaryCard({
  itemId, itemUnit,
  rm, labour, overhead,
  buffers, stages, itemLosses,
}: {
  itemId: string;
  itemUnit: string;
  rm: number;
  labour: number;
  overhead: number;
  buffers: Buffers | null;
  stages: StageLossInfo[];
  /** Root item's own loss columns — fallback when the cascade doesn't
   *  carry a stage with the loss set. */
  itemLosses?: {
    production_loss_pct: number | null;
    cooking_loss_pct: number | null;
    packing_loss_pct: number | null;
    open_pack_pct: number | null;
    giveaway_pct: number | null;
  };
}) {
  const direct = rm + labour;
  const indirect = overhead;
  const cogs = direct + indirect;

  // Each loss looked up at its natural stage in the cascade — production
  // at WIP/WIPF, cooking at WIPF (with process_loss fallback), packing at
  // WIPP, open_pack at FG, giveaway at WIPP/FG. Same logic as the cost
  // sheet so both views reconcile.
  const prodLoss = lossFromStages(stages, "production_loss_pct", ["wip", "wipf"],          buffers?.production_loss_pct ?? 0, itemLosses?.production_loss_pct ?? null);
  const cookLoss = cookingLossEffective(stages,                                              buffers?.cooking_loss_pct    ?? 0);
  const packLoss = lossFromStages(stages, "packing_loss_pct",    ["wipp", "wipf"],          buffers?.packing_loss_pct    ?? 0, itemLosses?.packing_loss_pct ?? null);
  const openPack = lossFromStages(stages, "open_pack_pct",       ["finished_good", "wipp"], buffers?.open_pack_pct       ?? 0, itemLosses?.open_pack_pct ?? null);
  const giveaway = lossFromStages(stages, "giveaway_pct",        ["wipp", "finished_good"], buffers?.giveaway_pct        ?? 0, itemLosses?.giveaway_pct ?? null);

  // Compounded loss uplift — capture each step's marginal contribution so
  // the 3-section card can break out individual lines (matching the cost
  // sheet rendering).
  const step1 = compound(cogs,   prodLoss); const prodLossAmt = step1 - cogs;
  const step2 = compound(step1,  cookLoss); const cookLossAmt = step2 - step1;
  const step3 = compound(step2,  packLoss); const packLossAmt = step3 - step2;
  const step4 = compound(step3,  openPack); const openPackAmt = step4 - step3;
  const step5 = compound(step4,  giveaway); const giveawayAmt = step5 - step4;
  const postLoss   = step5;
  const lossesAmt  = postLoss - cogs;

  // Markups (flat % of post-loss basis — no inter-markup compounding).
  const deprAmt   = postLoss * (buffers?.depreciation_pct ?? 0) / 100;
  const sampleAmt = postLoss * (buffers?.sample_pct       ?? 0) / 100;
  const pdevAmt   = postLoss * (buffers?.product_dev_pct  ?? 0) / 100;
  const errorAmt  = postLoss * (buffers?.error_pct        ?? 0) / 100;
  const markupsAmt = deprAmt + sampleAmt + pdevAmt + errorAmt;

  const loadedCost = postLoss + markupsAmt;
  const marginPct  = buffers?.target_margin_pct ?? 0;
  const minSell    = (marginPct > 0 && marginPct < 100)
    ? loadedCost / (1 - marginPct / 100)
    : loadedCost;

  const hasAnyCost = cogs > 0;
  // Count how many of the 5 loss categories have a non-zero value — used
  // in the card's "N categories compounded" hint.
  const lossesPctCount =
    (prodLoss > 0 ? 1 : 0) +
    (cookLoss > 0 ? 1 : 0) +
    (packLoss > 0 ? 1 : 0) +
    (openPack > 0 ? 1 : 0) +
    (giveaway > 0 ? 1 : 0);

  return (
    <div className="card" style={{ borderLeft: "3px solid #166534", marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5rem", gap: "0.5rem", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>
          💰 Cost summary
          <span style={{ marginLeft: "0.5rem", fontSize: "0.65rem", color: "#78716c", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>admin view</span>
        </h2>
        <Link href={`/costings/${itemId}`} style={{ fontSize: "0.75rem", color: "#b91c1c", textDecoration: "none" }}>
          View full cost sheet →
        </Link>
      </div>
      <p style={{ fontSize: "0.75rem", color: "#78716c", margin: "0 0 0.625rem" }}>
        Per <strong>1 {itemUnit}</strong>. Loss buffers compounded using this item&apos;s own values
        with tenant defaults as fallback. Cooking loss defaults to Filling Attributes&apos; process loss
        if blank. Full per-stage attribution is on the cost sheet.
      </p>

      {!hasAnyCost ? (
        <div style={{ fontSize: "0.8125rem", color: "#a8a29e", fontStyle: "italic" }}>
          No cost computed yet — set supplier prices on raw materials or check for missing BOM data.
        </div>
      ) : (
        <div style={{ maxWidth: 540 }}>
          {/* Single column, top-down — same flow as /costings/[id] cost sheet. */}
          <Row label="Direct" sub="RM + Labour" value={direct} subtle indent />
          <Row label="Indirect" sub="Overhead" value={indirect} subtle indent />
          <Divider />
          <Row label="COGS / unit" sub="cost of goods (RM + Labour + OH)" value={cogs} bold />

          {/* ── Section 1: Direct losses (red) ─────────────────────────── */}
          <CostSection
            label="Direct losses"
            tint="red"
            subtotal={lossesAmt}
            subtotalLabel="Direct losses subtotal"
            runningTotal={postLoss}
            hide={lossesAmt <= 0}
          >
            {prodLoss > 0 && <Row label={`+ Production loss (${prodLoss}%)`} value={prodLossAmt} subtle compact />}
            {cookLoss > 0 && <Row label={`+ Cooking buffer (${cookLoss}%)`}  value={cookLossAmt} subtle compact />}
            {packLoss > 0 && <Row label={`+ Packing loss (${packLoss}%)`}    value={packLossAmt} subtle compact />}
            {openPack > 0 && <Row label={`+ Open packs (${openPack}%)`}      value={openPackAmt} subtle compact />}
            {giveaway > 0 && <Row label={`+ Giveaway (${giveaway}%)`}        value={giveawayAmt} subtle compact />}
          </CostSection>

          {/* ── Section 2: Indirect costs (blue) ───────────────────────── */}
          <CostSection
            label="Indirect costs"
            tint="blue"
            subtotal={markupsAmt}
            subtotalLabel="Indirect costs subtotal"
            runningTotal={loadedCost}
            hide={markupsAmt <= 0}
          >
            {(buffers?.depreciation_pct ?? 0) > 0 && <Row label={`+ Depreciation (${buffers?.depreciation_pct}%)`} value={deprAmt}   subtle compact />}
            {(buffers?.sample_pct       ?? 0) > 0 && <Row label={`+ Samples / QA (${buffers?.sample_pct}%)`}      value={sampleAmt} subtle compact />}
            {(buffers?.product_dev_pct  ?? 0) > 0 && <Row label={`+ Product dev (${buffers?.product_dev_pct}%)`}  value={pdevAmt}   subtle compact />}
            {(buffers?.error_pct        ?? 0) > 0 && <Row label={`+ Error margin (${buffers?.error_pct}%)`}       value={errorAmt}  subtle compact />}
          </CostSection>

          {lossesAmt <= 0 && markupsAmt <= 0 && (
            <Row label="No loss or markup buffers set" sub="see /costings/pricing" value={0} subtle muted />
          )}

          <Divider />
          <Row label="= Loaded cost" sub="cost price basis (no margin yet)" value={loadedCost} bold />

          {/* ── Section 3: Profit buffer (green) ───────────────────────── */}
          <CostSection
            label="Profit buffer"
            tint="green"
            subtotal={minSell - loadedCost}
            subtotalLabel="Profit buffer subtotal"
            runningTotal={minSell}
            hide={marginPct <= 0}
            hideSubtotalWhenSingle
          >
            <Row label={`+ Target margin uplift (${marginPct}%)`} value={minSell - loadedCost} subtle compact />
          </CostSection>

          <Divider thick />
          <Row label="MINIMUM SELL PRICE" sub="rock-bottom price — do not undercut" value={minSell} emphasis unit={itemUnit} />

          <div style={{ marginTop: "0.625rem", fontSize: "0.7rem", color: "#a8a29e", fontStyle: "italic" }}>
            Per-loss and per-markup attribution is on the <Link href={`/costings/${itemId}`} style={{ color: "#b91c1c" }}>full cost sheet</Link>.
            This card is visible to admin / manager / super-admin roles only.
          </div>
        </div>
      )}
    </div>
  );
}

// Tints for the 3 buildup sections (red / blue / green) — match the cost sheet.
const SECTION_TINTS: Record<"red" | "blue" | "green", { border: string; bg: string; label: string }> = {
  red:   { border: "#fca5a5", bg: "#fef2f2", label: "#b91c1c" },
  blue:  { border: "#93c5fd", bg: "#eff6ff", label: "#1d4ed8" },
  green: { border: "#86efac", bg: "#f0fdf4", label: "#15803d" },
};

function CostSection({ label, tint, subtotal, subtotalLabel, runningTotal, hide, hideSubtotalWhenSingle, children }: {
  label: string;
  tint: "red" | "blue" | "green";
  subtotal: number;
  subtotalLabel: string;
  runningTotal?: number;
  hide?: boolean;
  hideSubtotalWhenSingle?: boolean;
  children: React.ReactNode;
}) {
  if (hide) return null;
  const c = SECTION_TINTS[tint];
  const childArr = React.Children.toArray(children).filter(Boolean);
  const showSubtotalLabel = !(hideSubtotalWhenSingle && childArr.length <= 1);
  const fmtAud = (n: number) =>
    n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return (
    <div style={{
      borderLeft: `3px solid ${c.border}`,
      background: c.bg,
      borderRadius: "0 0.375rem 0.375rem 0",
      padding: "0.45rem 0.6rem 0.5rem",
      marginTop: "0.45rem",
      marginBottom: "0.45rem",
    }}>
      <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: c.label, marginBottom: "0.25rem" }}>
        {label}
      </div>
      {children}
      {(showSubtotalLabel || runningTotal != null) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: "0.3rem", paddingTop: "0.3rem", borderTop: `1px dashed ${c.border}`, fontSize: "0.8125rem", fontWeight: 600, color: c.label, gap: "0.5rem" }}>
          <span>{showSubtotalLabel ? subtotalLabel : ""}</span>
          <span style={{ display: "flex", alignItems: "baseline", gap: "0.625rem", fontFamily: "monospace" }}>
            {showSubtotalLabel && <span>+{fmtAud(subtotal)}</span>}
            {runningTotal != null && (
              <span style={{ color: c.label, opacity: 0.85, fontWeight: 700 }}>
                <span style={{ color: "#a8a29e", fontWeight: 400, fontStyle: "italic", marginRight: "0.2rem" }}>→</span>
                {fmtAud(runningTotal)}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function Row({ label, sub, value, bold = false, subtle = false, emphasis = false, colour = "#1c1917", unit, indent = false, muted = false, compact = false }: {
  label: string; sub?: string; value: number; compact?: boolean;
  bold?: boolean; subtle?: boolean; emphasis?: boolean;
  colour?: string; unit?: string;
  /** Indent the label slightly (used for Direct/Indirect under COGS). */
  indent?: boolean;
  /** Render the value as "—" / faded when zero (for "none set" rows). */
  muted?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: emphasis ? "0.4rem 0 0.2rem" : "0.18rem 0", gap: "0.75rem", paddingLeft: indent ? "1.25rem" : 0 }}>
      <span style={{
        fontSize: emphasis ? "0.95rem" : "0.85rem",
        fontWeight: emphasis ? 700 : bold ? 600 : 400,
        color: muted ? "#a8a29e" : (subtle ? "#78716c" : "#1c1917"),
        textTransform: emphasis ? "uppercase" : "none",
        letterSpacing: emphasis ? "0.04em" : 0,
      }}>
        {label}
        {sub && (
          <span style={{ marginLeft: "0.4rem", fontSize: "0.65rem", color: "#a8a29e", fontWeight: 400, fontStyle: "italic", textTransform: "none", letterSpacing: 0 }}>· {sub}</span>
        )}
      </span>
      <span style={{
        fontFamily: "monospace",
        fontWeight: emphasis ? 700 : bold ? 700 : subtle ? 400 : 500,
        fontSize: emphasis ? "1.5rem" : bold ? "1rem" : "0.85rem",
        color: muted ? "#a8a29e" : (emphasis ? colour : (subtle ? colour : colour)),
        whiteSpace: "nowrap",
      }}>
        {muted
          ? <span style={{ color: "#a8a29e" }}>—</span>
          : emphasis
            ? <>{ "$" + value.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
                {unit && <span style={{ fontSize: "0.75rem", color: "#78716c", fontWeight: 400, marginLeft: 3 }}>/{unit}</span>}
              </>
            : fmt(value, 4)}
      </span>
    </div>
  );
}

function Divider({ thick = false }: { thick?: boolean }) {
  return (
    <hr style={{
      gridColumn: "1 / -1", border: 0,
      borderTop: thick ? "2px solid #1c1917" : "1px solid #e7e5e4",
      margin: "0.25rem 0",
    }} />
  );
}
