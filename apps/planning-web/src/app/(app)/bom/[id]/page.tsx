import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ITEM_TYPE_LABELS, ITEM_TYPE_COLORS, type ItemType } from "@/lib/types";
import { BackButton } from "@/components/back-button";
import { QuickNav } from "@/components/quick-nav";
import { BomDeleteButton } from "../_components/bom-delete-button";
import BomEditModal from "../_components/bom-edit-modal";

type BomLineRow = {
  id: string;
  sort_order: number;
  qty_per_batch: number;
  unit: string;
  percentage: number | null;
  grind_size: string | null;
  comment: string | null;
  basis: string | null;
  // M from the "N × item per M [scope]" entry pattern. 1 for recipe lines
  // and for "1-per-1" packaging; the actual denominator (e.g. 500 in
  // "1 bin per 500 kg") for properly normalised packaging lines.
  consume_per_qty: number | null;
  component_item: {
    id: string;
    code: string;
    name: string;
    item_type: string;
    unit: string;
    consumed_in_weight: boolean | null;
  } | null;
};

export default async function BomDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: bom } = await supabase
    .from("bom_headers")
    .select(`
      id, version, reference_batch_size, reference_batch_unit, yield_factor,
      is_active, approved_at, approved_by, notes, created_at, updated_at,
      item:item_id(id, code, name, item_type, department, default_batch_size, batch_unit),
      lines:bom_lines(
        id, sort_order, qty_per_batch, unit, percentage, grind_size, comment, basis, consume_per_qty,
        component_item:component_item_id(id, code, name, item_type, unit, consumed_in_weight)
      )
    `)
    .eq("id", id)
    .single();

  if (!bom) notFound();

  const item = bom.item as {
    id: string; code: string; name: string; item_type: string;
    department: string | null; default_batch_size: number | null; batch_unit: string | null;
  } | null;

  const lines = ((bom.lines ?? []) as BomLineRow[]).sort((a, b) => a.sort_order - b.sort_order);
  // Recipe-only sum (weight ingredients): used to display normalized
  // percentages and a meaningful "Recipe input" summary.
  // Packaging / casings / consumables don't share a weight unit so summing
  // them as kg would be nonsense.
  const recipeLines    = lines.filter(l => l.component_item?.consumed_in_weight !== false);
  const packagingLines = lines.filter(l => l.component_item?.consumed_in_weight === false);
  const recipeQty      = recipeLines.reduce((s, l) => s + l.qty_per_batch, 0);
  // Used by the per-line "% of batch" hint in the table — same divisor as MRP.
  const totalQty       = recipeQty;

  // Per-line cost data — pulled from the same cost cascade the /costings page
  // uses, so the numbers reconcile. v_item_landed_cost_v3 has rm_cost_per_unit
  // for every item (RMs = their own preferred-supplier price, WIPs/FGs = the
  // recursive cascade total). One query for all components on the page.
  const componentIds = Array.from(new Set(
    lines.map(l => l.component_item?.id).filter((x): x is string => !!x)
  ));
  const { data: componentCosts } = componentIds.length > 0
    ? await supabase
        .from("v_item_landed_cost_v3")
        .select("item_id, rm_cost_per_unit, total_cost_per_unit, has_active_bom")
        .in("item_id", componentIds)
    : { data: [] };
  // For RMs we want their direct cost; for WIPs we want the cascaded total
  // (RM + labour + OH) so the BOM total reads like a true loaded cost.
  // total_cost_per_unit already includes labour + OH when there's a BOM,
  // otherwise it falls back to rm_cost_per_unit.
  const costByItemId = new Map<string, { unitCost: number | null; isLoaded: boolean }>();
  for (const c of (componentCosts ?? []) as Array<{ item_id: string; rm_cost_per_unit: number | null; total_cost_per_unit: number | null; has_active_bom: boolean | null }>) {
    const total = c.total_cost_per_unit ?? c.rm_cost_per_unit;
    costByItemId.set(c.item_id, {
      unitCost: total != null ? Number(total) : null,
      isLoaded: !!c.has_active_bom,
    });
  }
  // Per-line line cost (qty × unit cost) and batch totals.
  const linesWithCost = lines.map(l => {
    const cost = l.component_item ? costByItemId.get(l.component_item.id) : null;
    const unitCost = cost?.unitCost ?? null;
    const lineCost = unitCost != null ? unitCost * l.qty_per_batch : null;
    return { line: l, unitCost, lineCost, isLoaded: cost?.isLoaded ?? false };
  });
  const batchTotalCost = linesWithCost.reduce((s, x) => s + (x.lineCost ?? 0), 0);
  const linesMissingCost = linesWithCost.filter(x => x.lineCost == null && x.line.component_item).length;
  const batchSizeKg = bom.reference_batch_unit === "kg" ? bom.reference_batch_size : null;
  const costPerKg = batchSizeKg && batchSizeKg > 0 ? batchTotalCost / batchSizeKg : null;
  const fmtAud = (n: number | null) => n == null
    ? "—"
    : n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Get other BOM versions for this item
  const { data: otherVersions } = item
    ? await supabase
        .from("bom_headers")
        .select("id, version, is_active, approved_at")
        .eq("item_id", item.id)
        .neq("id", id)
        .order("version")
    : { data: [] };

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <BackButton href="/bom" label="BOMs" />
            <span style={{ color: "#d4d4d4" }}>|</span>
            <QuickNav />
            {item && (
              <>
                <span style={{ color: "#78716c", fontSize: "0.875rem" }}>·</span>
                <Link
                  href={`/items/${item.id}`}
                  style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", color: "#b91c1c", textDecoration: "none", fontSize: "0.8125rem", fontWeight: 500 }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                  </svg>
                  {item.code} — Item Master
                </Link>
              </>
            )}
          </div>
          <h1 className="page-title" style={{ marginTop: "0.375rem" }}>
            {item?.name ?? "BOM"} — v{bom.version}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginTop: "0.375rem" }}>
            {item && (
              <span className={`badge ${ITEM_TYPE_COLORS[item.item_type as ItemType]}`}>
                {ITEM_TYPE_LABELS[item.item_type as ItemType]}
              </span>
            )}
            {bom.is_active
              ? <span className="badge badge-green">Active</span>
              : <span className="badge badge-gray">Inactive (draft)</span>}
            {/* Approved badge hidden — Tino May 2026: 'active is more than
                enough'. The DB column stays for historical specs. */}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.625rem", alignItems: "center" }}>
          {/* Delete only allowed on inactive BOMs — once it's the active
              version it's the recipe of record and shouldn't disappear. */}
          {!bom.is_active && (
            <BomDeleteButton
              bomId={bom.id}
              label={`${item?.name ?? "BOM"} v${bom.version}`}
            />
          )}
          {item && (
            <Link href={`/bom/new?item_id=${item.id}`} className="btn-secondary">+ New Version</Link>
          )}
          <Link href={`/bom/${id}/routing`} className="btn-secondary" title="Production routing — steps, people, minutes, $/kg">
            ⚙ Routing
          </Link>
          <BomEditModal bomId={id} approvedAt={bom.approved_at} />
        </div>
      </div>

      {/* Summary bar */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
          {[
            ["Reference Batch", `${bom.reference_batch_size} ${bom.reference_batch_unit}`,
              "Indicator only — not used in MRP"],
            ["Yield Factor", `${Math.round(bom.yield_factor * 100)}%`, ""],
            ["Recipe Lines", recipeLines.length === 0
              ? "—"
              : `${recipeLines.length} item${recipeLines.length !== 1 ? "s" : ""} · ${recipeQty.toLocaleString("en-AU", { maximumFractionDigits: 3 })} ${bom.reference_batch_unit ?? ""}`,
              "Weight ingredients (consumed_in_weight = TRUE) — auto-normalised to 100% by MRP"],
            ["Packaging Lines", packagingLines.length === 0
              ? "—"
              : `${packagingLines.length} item${packagingLines.length !== 1 ? "s" : ""}`,
              "Casings, labels, crates, consumables — scaled by basis (per_piece/inner/outer/pallet/kg)"],
          ].map(([label, value, tip]) => (
            <div key={label} title={tip || undefined}>
              <div style={{ fontSize: "0.75rem", color: "#78716c" }}>{label}</div>
              <div style={{ fontSize: "1rem", fontWeight: "700", color: "#292524", marginTop: "0.125rem" }}>{value}</div>
            </div>
          ))}
        </div>
        {bom.notes && (
          <div style={{ marginTop: "0.875rem", padding: "0.625rem 0.75rem", background: "#fafaf9", borderRadius: "0.375rem", fontSize: "0.875rem", color: "#78716c" }}>
            <strong>Notes:</strong> {bom.notes}
          </div>
        )}
        {bom.approved_at && (
          <div style={{ marginTop: "0.625rem", fontSize: "0.8125rem", color: "#166534" }}>
            ✓ Approved {new Date(bom.approved_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
          </div>
        )}
      </div>

      {/* Read-only ingredient view */}
      {lines.length > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: "1.5rem" }}>
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Ingredients</h2>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Component</th>
                <th>Code</th>
                <th>Type</th>
                <th>Qty / Batch</th>
                <th>% of Batch</th>
                <th style={{ textAlign: "right" }} title="Per-unit cost from preferred supplier (RM) or cascaded total (WIP/FG)">Unit Cost</th>
                <th style={{ textAlign: "right" }} title="Qty × Unit Cost">Line Cost</th>
                <th>Grind Size</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {linesWithCost.map(({ line, unitCost, lineCost, isLoaded }, idx) => {
                // % of batch is meaningful ONLY for recipe (weight) lines.
                // Packaging/casings show "—" since they're scaled by basis,
                // not by share-of-recipe-weight.
                const isRecipe = line.component_item?.consumed_in_weight !== false;
                const pct = !isRecipe
                  ? "—"
                  : line.percentage != null
                    ? line.percentage
                    : recipeQty > 0 ? ((line.qty_per_batch / recipeQty) * 100).toFixed(1) : "—";
                return (
                  <tr key={line.id}>
                    <td style={{ color: "#a8a29e", fontSize: "0.8125rem", textAlign: "center" }}>{idx + 1}</td>
                    <td style={{ fontWeight: "500" }}>
                      {line.component_item ? (
                        <Link href={`/items/${line.component_item.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                          {line.component_item.name}
                        </Link>
                      ) : "—"}
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>
                      {line.component_item?.code ?? "—"}
                    </td>
                    <td>
                      {line.component_item && (
                        <span className={`badge ${ITEM_TYPE_COLORS[line.component_item.item_type as ItemType]}`} style={{ fontSize: "0.625rem" }}>
                          {ITEM_TYPE_LABELS[line.component_item.item_type as ItemType]}
                        </span>
                      )}
                    </td>
                    <td style={{ fontWeight: "600" }}>
                      {(() => {
                        // Packaging / consumable lines display in the same
                        // "N × item per M [scope]" form the edit modal uses,
                        // so the read-only view matches how you entered it.
                        // Recipe lines (no basis) fall back to "qty unit".
                        const scopeLabel = (() => {
                          switch (line.basis) {
                            case "per_kg":     return "kg of FG";
                            case "per_piece":  return "unit";
                            case "per_inner":  return "inner";
                            case "per_outer":  return "outer";
                            case "per_pallet": return "pallet";
                            default:           return null;
                          }
                        })();
                        if (scopeLabel && line.basis) {
                          const M = line.consume_per_qty ?? 1;
                          const N = line.qty_per_batch * M;
                          const fmt = (n: number) => Number.isInteger(n)
                            ? String(n)
                            : n.toLocaleString("en-AU", { maximumFractionDigits: 4 });
                          return (
                            <>
                              <div>{fmt(N)} {line.unit} <span style={{ color: "#a8a29e", fontWeight: 400 }}>per</span> {fmt(M)} {scopeLabel}</div>
                              <div style={{ fontSize: "0.65rem", color: "#a8a29e", fontWeight: 400, marginTop: "0.125rem" }}>
                                = {line.qty_per_batch.toLocaleString("en-AU", { maximumFractionDigits: 6 })} {line.unit}/{bom.reference_batch_unit ?? "kg"} of batch
                              </div>
                            </>
                          );
                        }
                        return <>{line.qty_per_batch} {line.unit}</>;
                      })()}
                    </td>
                    <td style={{ color: "#78716c" }}>{pct === "—" ? "—" : `${pct}%`}</td>
                    <td style={{ textAlign: "right", fontFamily: "monospace", fontSize: "0.8125rem", color: unitCost == null ? "#dc2626" : "#292524" }} title={isLoaded ? "Loaded cost (RM + labour + OH from this item's own BOM)" : undefined}>
                      {unitCost == null ? "—" : `${fmtAud(unitCost)}/${line.unit}`}
                      {isLoaded && <span style={{ marginLeft: "0.25rem", color: "#a8a29e", fontSize: "0.65rem" }}>L</span>}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "monospace", fontSize: "0.8125rem", fontWeight: "600", color: lineCost == null ? "#dc2626" : "#292524" }}>
                      {fmtAud(lineCost)}
                    </td>
                    <td style={{ color: "#78716c", fontFamily: line.grind_size ? "monospace" : undefined }}>
                      {line.grind_size ?? "—"}
                    </td>
                    <td style={{ color: "#78716c" }}>{line.comment ?? "—"}</td>
                  </tr>
                );
              })}
              {/* Totals row — recipe (weight) lines only for the qty / %.
                  Cost totals include ALL lines (recipe + packaging) since
                  packaging is part of the cost of a batch even if it doesn't
                  contribute to the weight subtotal. */}
              <tr style={{ background: "#fafaf9", fontWeight: "600" }}>
                <td colSpan={4} style={{ padding: "0.5rem 0.75rem", fontSize: "0.8125rem", color: "#78716c", textAlign: "right" }}>Recipe Total <span style={{ fontWeight: 400, fontStyle: "italic" }}>(weight ingredients only)</span></td>
                <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem" }}>
                  {recipeLines.length === 0 ? "—" : `${recipeQty.toLocaleString("en-AU", { maximumFractionDigits: 3 })} ${bom.reference_batch_unit ?? ""}`}
                </td>
                <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.8125rem", color: "#78716c" }}>{recipeLines.length === 0 ? "—" : "100%"}</td>
                <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }} title="Cost per kg of finished batch (total batch cost ÷ batch size)">
                  {costPerKg == null
                    ? "—"
                    : `${fmtAud(costPerKg)}/${bom.reference_batch_unit ?? "kg"}`}
                </td>
                <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontFamily: "monospace", fontSize: "0.875rem" }} title={linesMissingCost > 0 ? `${linesMissingCost} line${linesMissingCost === 1 ? "" : "s"} missing cost — batch total may be incomplete` : "Total cost per reference batch"}>
                  {fmtAud(batchTotalCost)}
                  {linesMissingCost > 0 && <span style={{ marginLeft: "0.25rem", color: "#dc2626", fontSize: "0.7rem" }} title={`${linesMissingCost} line(s) missing cost`}>⚠</span>}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Other versions */}
      {otherVersions && otherVersions.length > 0 && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.75rem" }}>Other Versions</h2>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {otherVersions.map(v => (
              <Link
                key={v.id}
                href={`/bom/${v.id}`}
                className="btn-secondary"
                style={{ fontSize: "0.8125rem" }}
              >
                v{v.version}
                v{v.version}
                {v.is_active && " *"}
              </Link>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
