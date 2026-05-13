"use client";

/**
 * Client-side body of the work-order page.
 *
 * Layout (top → bottom):
 *   [3-column header strip — Specs · Work instructions · Planner notes]
 *   [BOM summary banner (recipe meta + coverage tally)]
 *   [BOM table — single-batch · total production · today · grind · BOM notes]
 *   [Draggable batch-entry modal (per BOM row)]
 *
 * Behaviours:
 *   • All modals are draggable by the title bar — click and hold the header
 *     to slide the modal out of the way when you need to read the table
 *     behind it. Position resets next time it opens.
 *   • First input gets focus when the modal opens. Tab moves through fields
 *     in row-major order (batch → qty → unit → next row). Enter on any input
 *     either submits (when valid) or jumps to the next field.
 *   • Esc closes the modal.
 */

import { useState, useTransition, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { saveOrderConsumption, lockOrderTraceability, unlockOrderTraceability, setActualProduction, type ConsumptionLot } from "../../../dept/actions";
import { formatQty } from "@/lib/format";
import { openItemInPopup } from "@/lib/popup";
import { DraggableModal } from "@/components/draggable-modal";

type BomLine = {
  componentItemId: string;
  code: string;
  name: string;
  itemType: string;
  unit: string;
  qtyPerRefBatch: number;
  percentage: number | null;
  refBatchSize: number;
  yieldFactor: number;
  qtyForThisOrder: number;
  qtyTotalForDay: number;
  grindSize: string | null;
  lineComment: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  subcategoryId: string | null;
  subcategoryName: string | null;
  consumedLots: ConsumptionLot[];
};

// Sort key set — what the operator can sort by. "code"/"name"/"category"/etc
// map to the BomLine fields below. Multi-sort: array of {key, dir} applied
// in order, each one being a tiebreaker for the previous.
type SortKey = "code" | "name" | "type" | "category" | "subcategory"
  | "single" | "total" | "unit" | "grind" | "recorded";
type SortDir = "asc" | "desc";
type SortRule = { key: SortKey; dir: SortDir };

const SORT_LABELS: Record<SortKey, string> = {
  code: "Code", name: "Name", type: "Type", category: "Category", subcategory: "Subcat",
  single: "Single batch", total: "Total production",
  unit: "UOM", grind: "Mince size", recorded: "Recorded",
};

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

export default function WorkOrderClient({
  orderId,
  orderUnit,
  plannedQty,
  batchSize,
  nOfBatches,
  actualQty,
  actualBatchSize,
  actualNOfBatches,
  refBatchSize,
  yieldFactor,
  productionDate,
  plannerNotes,
  itemAttrs,
  itemDept,
  bomLines,
  bomVersionUsed,
  lockedAt,
  lockedByName,
  isAdmin,
}: {
  orderId: string;
  orderUnit: string;
  /** What the planner said. */
  plannedQty: number;
  batchSize: number;
  nOfBatches: number;
  /** What the floor actually produced. Null = no override; planned values
   *  are what's used everywhere. When set, the BOM table scales to actual
   *  so consumption matches what's really being made. */
  actualQty: number | null;
  actualBatchSize: number | null;
  actualNOfBatches: number | null;
  refBatchSize: number;
  yieldFactor: number;
  weekStart: string | null;
  productionDate: string | null;
  plannerNotes: string | null;
  itemAttrs: ItemAttrs;
  itemDept: string | null;
  bomLines: BomLine[];
  bomVersionUsed: number | null;
  lockedAt: string | null;
  lockedByName: string | null;
  isAdmin: boolean;
}) {
  const isLocked = !!lockedAt;
  // Effective qty / batch sizing — use the floor's override when set, fall
  // back to the planner's numbers otherwise. Everything BOM-scaled (Single
  // batch / Total production / consumption requirement) reads off these.
  const hasOverride = actualQty != null && actualBatchSize != null && actualNOfBatches != null;
  const effectiveQty       = hasOverride ? actualQty! : plannedQty;
  const effectiveBatchSize = hasOverride ? actualBatchSize! : batchSize;
  const effectiveNOfBatches = hasOverride ? actualNOfBatches! : nOfBatches;
  // Variance vs plan — reported in the override panel.
  const variance = hasOverride ? effectiveQty - plannedQty : 0;
  const variancePct = plannedQty > 0 ? (variance / plannedQty) * 100 : 0;

  /** Scale a BOM line's "qty for this order" to the EFFECTIVE qty (actual
   *  when set, planned otherwise). The server pre-computes qtyForThisOrder
   *  against the planner's number; we re-scale linearly here so changing
   *  actuals in the UI updates the BOM table immediately without a fetch. */
  function scaledQty(l: BomLine): number {
    if (l.yieldFactor <= 0) return 0;
    // Prefer percentage when set on a kg-unit line — that's the canonical
    // recipe source (mig 108: bom_lines.percentage is the source of truth for
    // weight ingredients; qty_per_batch is informational). Fall back to the
    // qty_per_batch ratio for non-weight lines (per_piece, per_carton, etc).
    if ((l.unit ?? "").toLowerCase() === "kg" && l.percentage != null && l.percentage > 0) {
      return effectiveQty * (l.percentage / 100) / l.yieldFactor;
    }
    if (l.refBatchSize <= 0) return 0;
    return (l.qtyPerRefBatch * effectiveQty / l.refBatchSize) / l.yieldFactor;
  }
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<BomLine | null>(null);
  const [draft, setDraft] = useState<ConsumptionLot[]>([]);
  const [draftNotes, setDraftNotes] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<"success" | "error" | null>(null);

  // Multi-sort: array of {key, dir} rules applied in order. Click a header
  // to set/toggle that key as the SOLE sort. Shift+click adds it to the
  // existing rule list (stacked tiebreaker). Click an active key again to
  // toggle direction; click a third time to clear.
  // Default: largest single-batch qty on top — operator's natural reading
  // order is "what do I need most of for the next mix?" (Tino, May 2026).
  const [sortRules, setSortRules] = useState<SortRule[]>([
    { key: "single", dir: "desc" },
  ]);

  function applyHeaderClick(key: SortKey, shift: boolean) {
    setSortRules(prev => {
      const existing = prev.find(r => r.key === key);
      if (shift) {
        // Add to / cycle within the multi-sort stack.
        if (!existing) return [...prev, { key, dir: "asc" }];
        if (existing.dir === "asc") return prev.map(r => r.key === key ? { ...r, dir: "desc" } : r);
        return prev.filter(r => r.key !== key);
      }
      // Single-sort: replace the rules with just this key, cycling direction.
      if (!existing) return [{ key, dir: "asc" }];
      if (existing.dir === "asc") return [{ key, dir: "desc" }];
      return [];
    });
  }

  // Compare a single rule's value extraction. Numbers compared numerically,
  // strings localised + case-insensitive. Nulls always sort last.
  function cmp(a: BomLine, b: BomLine, key: SortKey): number {
    const v = (l: BomLine) => {
      switch (key) {
        case "code": return l.code ?? "";
        case "name": return l.name ?? "";
        case "type": return l.itemType ?? "";
        case "category": return l.categoryName ?? "";
        case "subcategory": return l.subcategoryName ?? "";
        // BOM-scaled values use the floor's actual when set, else planned.
        case "single": return effectiveNOfBatches > 0 ? scaledQty(l) / effectiveNOfBatches : scaledQty(l);
        case "total": return scaledQty(l);
        case "unit": return l.unit ?? "";
        case "grind": return l.grindSize ?? "";
        case "recorded": return l.consumedLots.reduce((s, x) => s + Number(x.qty_used || 0), 0);
      }
    };
    const av = v(a), bv = v(b);
    const aEmpty = av === "" || av == null;
    const bEmpty = bv === "" || bv == null;
    if (aEmpty && !bEmpty) return 1;
    if (!aEmpty && bEmpty) return -1;
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    return String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
  }

  // Sorted view of the BOM lines per the current sortRules.
  const sortedBomLines = useMemo(() => {
    if (sortRules.length === 0) return bomLines;
    const arr = [...bomLines];
    arr.sort((a, b) => {
      for (const r of sortRules) {
        const c = cmp(a, b, r.key);
        if (c !== 0) return r.dir === "asc" ? c : -c;
      }
      return 0;
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bomLines, sortRules, nOfBatches]);

  // ── Floor-side production override ───────────────────────────────────────
  // Inputs prefilled with whatever's in the DB — when there's no override
  // we seed from the plan so the operator can edit one number and hit save.
  const [overrideN, setOverrideN] = useState<string>(
    actualNOfBatches != null ? String(actualNOfBatches) : String(nOfBatches)
  );
  const [overrideSize, setOverrideSize] = useState<string>(
    actualBatchSize != null ? String(actualBatchSize) : String(batchSize)
  );
  const computedActual = (() => {
    const n = Number(overrideN);
    const s = Number(overrideSize);
    if (n > 0 && s > 0) return n * s;
    return null;
  })();
  function saveActuals() {
    const n = Number(overrideN);
    const s = Number(overrideSize);
    if (!Number.isFinite(n) || !Number.isFinite(s) || n <= 0 || s <= 0) {
      setMsg("Both number of batches and batch size must be positive numbers.");
      setMsgKind("error");
      return;
    }
    startTransition(async () => {
      const r = await setActualProduction(orderId, Math.round(n), s);
      if (r.error) { setMsg(r.error); setMsgKind("error"); }
      else {
        setMsg(`Actuals saved: ${Math.round(n)} × ${s} = ${r.actualQty} ${orderUnit}.`);
        setMsgKind("success");
        router.refresh();
      }
    });
  }
  function resetActuals() {
    if (!confirm("Clear the actual override and revert the BOM to planned values? Recorded batch consumption will stay; only the planned-vs-actual sizing resets.")) return;
    startTransition(async () => {
      const r = await setActualProduction(orderId, null, null);
      if (r.error) { setMsg(r.error); setMsgKind("error"); }
      else {
        setOverrideN(String(nOfBatches));
        setOverrideSize(String(batchSize));
        setMsg("Override cleared — BOM scales to plan again.");
        setMsgKind("success");
        router.refresh();
      }
    });
  }

  // ── QA lock controls ─────────────────────────────────────────────────────
  function doLock() {
    if (!confirm("Lock the traceability record for this work order? Once locked, only an admin can edit the recorded batches. This is a regulatory sign-off step.")) return;
    startTransition(async () => {
      const r = await lockOrderTraceability(orderId);
      if (r.error) { setMsg(r.error); setMsgKind("error"); }
      else { setMsg("Traceability locked."); setMsgKind("success"); router.refresh(); }
    });
  }
  function doUnlock() {
    if (!confirm("Unlock the traceability record? Operators can edit the recorded batches again until you re-lock.")) return;
    startTransition(async () => {
      const r = await unlockOrderTraceability(orderId);
      if (r.error) { setMsg(r.error); setMsgKind("error"); }
      else { setMsg("Traceability unlocked."); setMsgKind("success"); router.refresh(); }
    });
  }

  function openModal(line: BomLine) {
    if (isLocked) {
      setMsg("Traceability is locked. Ask an admin to unlock before editing.");
      setMsgKind("error");
      return;
    }
    // Set the editing target — without this the modal never appears (caught
    // by the !!editing check at the bottom of the render). Lost during the
    // QA-lock refactor.
    setEditing(line);
    setDraft([
      ...line.consumedLots.map(l => ({ ...l })),
      { batch_number: "", qty_used: 0, unit: line.unit },
    ]);
    setDraftNotes("");
  }
  function closeModal() {
    setEditing(null);
    setDraft([]);
    setDraftNotes("");
  }
  function updateRow(idx: number, patch: Partial<ConsumptionLot>) {
    setDraft(prev => prev.map((row, i) => i === idx ? { ...row, ...patch } : row));
  }
  function addRow() {
    setDraft(prev => [...prev, { batch_number: "", qty_used: 0, unit: editing?.unit ?? orderUnit }]);
  }
  function removeRow(idx: number) {
    setDraft(prev => prev.filter((_, i) => i !== idx));
  }
  function save() {
    if (!editing) return;
    startTransition(async () => {
      const r = await saveOrderConsumption(
        orderId,
        editing.componentItemId,
        draft,
        draftNotes.trim() || null,
      );
      if (r.error) {
        setMsg(`Save failed: ${r.error}`);
        setMsgKind("error");
      } else {
        setMsg(`Recorded ${r.saved} lot${r.saved !== 1 ? "s" : ""} for ${editing.code}.`);
        setMsgKind("success");
        closeModal();
        router.refresh();
      }
    });
  }

  const totals = bomLines.reduce((acc, l) => {
    const recorded = l.consumedLots.reduce((s, x) => s + Number(x.qty_used || 0), 0);
    // Coverage check uses the scaled (effective) requirement so an active
    // override flips coverage thresholds with the new actual qty.
    const required = scaledQty(l);
    const covered = required > 0 ? recorded / required : 0;
    acc.linesCovered += covered >= 0.999 ? 1 : 0;
    acc.linesShort   += required > 0 && covered < 0.999 ? 1 : 0;
    return acc;
  }, { linesCovered: 0, linesShort: 0 });

  // Whether the dept is filling/packing/labelling — drives which attribute
  // sub-section ("Filling attributes" vs "Packing attributes") shows in the
  // Specs card. Falls back to "Specs" when we don't recognise the dept.
  const deptKey = (itemDept ?? "").toLowerCase();
  const isFillingDept = ["filling", "fill", "wipf"].includes(deptKey);
  const isPackingDept = ["packing", "finished_good", "labelling"].includes(deptKey);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
      {msg && (
        <div style={{
          padding: "0.6rem 0.875rem",
          background: msgKind === "error" ? "#fef2f2" : "#f0fdf4",
          border: `1px solid ${msgKind === "error" ? "#fca5a5" : "#86efac"}`,
          borderRadius: "0.375rem",
          fontSize: "0.8125rem",
          color: msgKind === "error" ? "#991b1b" : "#166534",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>{msg}</span>
          <button onClick={() => setMsg(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: "1rem", padding: 0, marginLeft: "0.5rem" }}>×</button>
        </div>
      )}

      {/* ── QA lock banner — visible whenever the record is locked, plus an
          admin-only "Lock now" action when it isn't. The banner is the
          regulatory marker: it tells anyone reading the page WHO signed
          this off and WHEN, plus which BOM version was used. */}
      <div style={{
        padding: "0.625rem 0.875rem",
        borderRadius: "0.5rem",
        border: `1px solid ${isLocked ? "#86efac" : "#e7e5e4"}`,
        background: isLocked ? "#f0fdf4" : "#fafaf9",
        display: "flex", alignItems: "center", gap: "0.875rem", flexWrap: "wrap",
        fontSize: "0.8125rem",
      }}>
        <span style={{ fontSize: "1.1rem" }}>{isLocked ? "🔒" : "🔓"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {isLocked ? (
            <>
              <div style={{ fontWeight: 700, color: "#166534" }}>Traceability locked</div>
              <div style={{ fontSize: "0.75rem", color: "#57534e" }}>
                Locked by <strong>{lockedByName ?? "?"}</strong> on{" "}
                <strong>{new Date(lockedAt!).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</strong>
                {bomVersionUsed != null && <> · BOM version <strong>v{bomVersionUsed}</strong></>}
                {" · "}consumption rows are read-only until an admin unlocks.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, color: "#1c1917" }}>Traceability unlocked</div>
              <div style={{ fontSize: "0.75rem", color: "#57534e" }}>
                Operators can record / edit batch consumption.
                {bomVersionUsed != null && <> Recipe being run: <strong>BOM v{bomVersionUsed}</strong>.</>}
                {" "}
                {isAdmin
                  ? "Lock the record once production is finished and QA signs off."
                  : "An admin will lock the record once production is finished and QA signs off."}
              </div>
            </>
          )}
        </div>
        {isAdmin && (
          isLocked
            ? <button onClick={doUnlock} disabled={isPending} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.4rem 0.75rem" }} title="Unlock so consumption rows can be edited">🔓 Unlock</button>
            : <button onClick={doLock} disabled={isPending} className="btn-primary" style={{ fontSize: "0.75rem", padding: "0.4rem 0.75rem", background: "#166534" }} title="Sign off and lock the traceability record">🔒 Lock traceability</button>
        )}
      </div>

      {/* ── Production override (planned vs actual) ─────────────────────────
          The PLAN never gets overwritten — planned_qty / batch_size /
          n_of_batches stay where the planner set them. Hitting Save here
          stamps the actual_* columns alongside, and everything BOM-scaled
          (Single batch / Total production / consumption requirements) reads
          from the actual values when they're set. Reset clears the
          override and the BOM goes back to scaling against the plan. */}
      <div style={{
        padding: "0.75rem 0.875rem",
        background: hasOverride ? "#fffbeb" : "#fafaf9",
        border: `1px solid ${hasOverride ? "#fcd34d" : "#e7e5e4"}`,
        borderRadius: "0.5rem",
        display: "flex", flexDirection: "column", gap: "0.5rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#854d0e", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            ⚖️ Planned vs actual
          </span>
          {hasOverride && (
            <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "0.1rem 0.5rem", background: "#fef3c7", color: "#854d0e", borderRadius: "9999px" }}>
              OVERRIDE ACTIVE
            </span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem", alignItems: "center" }}>
          {/* Planned (read-only) */}
          <div>
            <div style={{ fontSize: "0.7rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600, marginBottom: "0.2rem" }}>Planned</div>
            <div style={{ fontFamily: "monospace", fontSize: "0.95rem", fontWeight: 700, color: "#1c1917" }}>
              {nOfBatches} × {formatQty(batchSize, orderUnit)} {orderUnit} = {formatQty(plannedQty, orderUnit)} {orderUnit}
            </div>
          </div>
          {/* Actual (editable) */}
          <div>
            <div style={{ fontSize: "0.7rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600, marginBottom: "0.2rem" }}>
              Actual {hasOverride && <span style={{ color: "#854d0e" }}>(saved)</span>}
            </div>
            {isLocked ? (
              <div style={{ fontFamily: "monospace", fontSize: "0.95rem", fontWeight: 700, color: "#57534e" }}>
                {hasOverride
                  ? `${actualNOfBatches} × ${formatQty(actualBatchSize!, orderUnit)} ${orderUnit} = ${formatQty(actualQty!, orderUnit)} ${orderUnit}`
                  : "— (locked, no override)"}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                <input
                  type="number" step="1" min={1}
                  value={overrideN}
                  onChange={e => setOverrideN(e.target.value)}
                  className="form-input"
                  style={{ width: "5rem", textAlign: "right", fontFamily: "monospace" }}
                  title="Number of batches actually run"
                />
                <span style={{ color: "#57534e" }}>×</span>
                <input
                  type="number" step="0.01" min={0}
                  value={overrideSize}
                  onChange={e => setOverrideSize(e.target.value)}
                  className="form-input"
                  style={{ width: "7rem", textAlign: "right", fontFamily: "monospace" }}
                  title="Size of each actual batch"
                />
                <span style={{ color: "#57534e", fontSize: "0.8125rem" }}>{orderUnit}</span>
                <span style={{ color: "#57534e" }}>=</span>
                <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#1c1917" }}>
                  {computedActual != null ? `${formatQty(computedActual, orderUnit)} ${orderUnit}` : "—"}
                </span>
              </div>
            )}
          </div>
        </div>
        {/* Variance row + actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          {hasOverride && (
            <span style={{
              fontSize: "0.8125rem",
              color: variance === 0 ? "#166534" : variance > 0 ? "#1e3a8a" : "#b91c1c",
              fontWeight: 600,
            }}>
              Variance: {variance > 0 ? "+" : ""}{formatQty(variance, orderUnit)} {orderUnit}
              {plannedQty > 0 && <> ({variance > 0 ? "+" : ""}{variancePct.toFixed(1)}%)</>}
            </span>
          )}
          <span style={{ marginLeft: "auto", display: "flex", gap: "0.4rem" }}>
            {!isLocked && hasOverride && (
              <button
                type="button"
                onClick={resetActuals}
                disabled={isPending}
                className="btn-secondary"
                style={{ fontSize: "0.75rem", padding: "0.35rem 0.75rem" }}
                title="Clear the override and revert the BOM to planned values"
              >↺ Reset to planned</button>
            )}
            {!isLocked && (
              <button
                type="button"
                onClick={saveActuals}
                disabled={isPending}
                className="btn-primary"
                style={{ fontSize: "0.75rem", padding: "0.35rem 0.75rem", background: "#854d0e" }}
                title="Save the floor's actual production values — BOM will scale to actual"
              >💾 Save actual</button>
            )}
          </span>
        </div>
      </div>

      {/* ── Header cards: Specs · Work Instructions · Planner Notes ────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.75rem" }}>
        {/* Specs (filling/packing attributes) */}
        <InfoCard
          title={isFillingDept ? "🌭 Filling attributes" : isPackingDept ? "📦 Packing attributes" : "📋 Item specs"}
          accent="#1e3a8a"
        >
          <AttrRow label="Storage temp" value={itemAttrs.storageTemp} />
          <AttrRow label="Shelf life" value={itemAttrs.shelfLife} />
          <AttrRow label="Min shelf life on dispatch" value={itemAttrs.minShelfLifeDays != null ? `${itemAttrs.minShelfLifeDays} days` : null} />
          {(isFillingDept || itemAttrs.fillWeightG != null || itemAttrs.fillWeightRawG != null) && (
            <>
              <AttrRow label="Fill weight (raw)" value={itemAttrs.fillWeightRawG != null ? `${itemAttrs.fillWeightRawG} g/piece` : null} />
              <AttrRow label="Fill weight (cooked)" value={itemAttrs.fillWeightG != null ? `${itemAttrs.fillWeightG} g/piece` : null} />
              <AttrRow label="Target weight" value={itemAttrs.targetWeightG != null ? `${itemAttrs.targetWeightG} g/piece` : null} />
            </>
          )}
          {(isPackingDept || itemAttrs.unitsPerInner != null) && (
            <>
              <AttrRow label="Units per inner" value={itemAttrs.unitsPerInner} />
              <AttrRow label="Units per outer" value={itemAttrs.unitsPerOuter} />
              <AttrRow label="Packaging" value={itemAttrs.packaging} />
              <AttrRow label="Labelling" value={itemAttrs.labelling} />
            </>
          )}
          {itemAttrs.productionMethod && (
            <AttrRow label="Method" value={itemAttrs.productionMethod} />
          )}
        </InfoCard>

        {/* Work instructions — pulled from the production_method field for now;
            if you want a richer field per item, we can add items.work_instructions
            later. */}
        <InfoCard title="📖 Work instructions" accent="#854d0e">
          {itemAttrs.productionMethod ? (
            <div style={{ fontSize: "0.8125rem", color: "#1c1917", whiteSpace: "pre-wrap" }}>
              {itemAttrs.productionMethod}
            </div>
          ) : (
            <div style={{ fontSize: "0.8125rem", color: "#a8a29e", fontStyle: "italic" }}>
              No work instructions on this item yet. Add them in Item Master → Production method.
            </div>
          )}
        </InfoCard>

        {/* Planner notes — production_orders.notes is the planner's per-order
            free-text. Highlighted so it doesn't get lost. */}
        <InfoCard title="📝 Planner notes" accent="#b91c1c">
          {plannerNotes ? (
            <div style={{ fontSize: "0.8125rem", color: "#1c1917", whiteSpace: "pre-wrap" }}>
              {plannerNotes}
            </div>
          ) : (
            <div style={{ fontSize: "0.8125rem", color: "#a8a29e", fontStyle: "italic" }}>
              No notes from the planner for this work order.
            </div>
          )}
        </InfoCard>
      </div>

      {/* BOM summary banner */}
      <div style={{
        padding: "0.625rem 0.875rem", background: "#fafaf9", border: "1px solid #e7e5e4",
        borderRadius: "0.5rem",
        display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap",
        fontSize: "0.8125rem",
      }}>
        <span><strong>📋 Recipe:</strong> {bomLines.length} component{bomLines.length !== 1 ? "s" : ""}</span>
        <span><strong>Reference batch:</strong> {formatQty(refBatchSize, orderUnit)} {orderUnit} ({Math.round(yieldFactor * 100)}% yield)</span>
        <span><strong>This order:</strong> {formatQty(effectiveQty, orderUnit)} {orderUnit}
          {effectiveNOfBatches > 1 && (
            <span style={{ color: "#78716c" }}> = {effectiveNOfBatches} × {formatQty(effectiveBatchSize, orderUnit)} {orderUnit}</span>
          )}
          {hasOverride && (
            <span style={{ color: "#854d0e", fontSize: "0.7rem", fontWeight: 700, marginLeft: "0.4rem", padding: "0.05rem 0.35rem", borderRadius: "9999px", background: "#fef3c7" }}>
              ACTUAL
            </span>
          )}
        </span>
        <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "#57534e" }}>
          <span style={{ color: "#166534", fontWeight: 700 }}>✓ {totals.linesCovered}</span> covered
          {totals.linesShort > 0 && (
            <> · <span style={{ color: "#b91c1c", fontWeight: 700 }}>{totals.linesShort}</span> still need entry</>
          )}
        </span>
      </div>

      {/* Sort indicator strip — only visible while sorted, lets the operator
          see the rule stack and clear with one click. */}
      {sortRules.length > 0 && (
        <div style={{ fontSize: "0.7rem", color: "#57534e", display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#78716c" }}>Sorting by</span>
          {sortRules.map((r, i) => (
            <span key={r.key} style={{ background: "#fef3c7", color: "#854d0e", padding: "0.1rem 0.5rem", borderRadius: "9999px", fontWeight: 600 }}>
              {i + 1}. {SORT_LABELS[r.key]} {r.dir === "asc" ? "▲" : "▼"}
            </span>
          ))}
          <button type="button" onClick={() => setSortRules([])} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "0.7rem", padding: "0.1rem 0.4rem" }}>
            ✕ Clear
          </button>
          <span style={{ marginLeft: "auto", color: "#a8a29e", fontStyle: "italic" }}>
            Tip: Shift-click headers to add a tiebreaker sort.
          </span>
        </div>
      )}

      {/* BOM table.
          Wrapper has a max-height + sticky thead so the column headers stay
          locked at the top while the operator scrolls the rows. Horizontal
          scroll exposes the right-most "metadata" columns (Type / Category /
          Subcat) which are kept off the default viewport so the action area
          isn't cluttered for the floor operator — they're for sorting +
          deeper inspection only.
          Tablet UX: the first column ("Component") is sticky-left so the
          operator always sees what they're recording even while scrolling
          right to reach Recorded/Recorded batches/the Record button. The
          second-to-last column (Action) is also sticky-right so the Record
          CTA stays in reach. */}
      <div style={{
        overflow: "auto", border: "1px solid #e7e5e4", borderRadius: "0.5rem",
        maxHeight: "60vh",
      }}>
        <table className="data-table" style={{ fontSize: "0.8125rem", margin: 0 }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "#fafaf9" }}>
            <tr>
              <SortableTh sortKey="name" label="Component" sortRules={sortRules} onClick={applyHeaderClick} sticky="left" />
              <SortableTh sortKey="single" label="Single batch" sortRules={sortRules} onClick={applyHeaderClick} align="right" hint="Qty for ONE of THIS ORDER's batches" />
              <SortableTh sortKey="total" label="Total production" sortRules={sortRules} onClick={applyHeaderClick} align="right" hint="Total qty for this work order" />
              <SortableTh sortKey="unit" label="UOM" sortRules={sortRules} onClick={applyHeaderClick} />
              <SortableTh sortKey="grind" label="Mince size" sortRules={sortRules} onClick={applyHeaderClick} />
              <th>BOM notes</th>
              <th>Recorded batches</th>
              <SortableTh sortKey="recorded" label="Recorded" sortRules={sortRules} onClick={applyHeaderClick} align="right" hint="Sum of recorded qty" />
              <th></th>
              {/* Metadata columns parked at the right edge — visible only
                  via horizontal scroll. Still sortable. */}
              <SortableTh sortKey="type" label="Type" sortRules={sortRules} onClick={applyHeaderClick} />
              <SortableTh sortKey="category" label="Category" sortRules={sortRules} onClick={applyHeaderClick} />
              <SortableTh sortKey="subcategory" label="Subcat" sortRules={sortRules} onClick={applyHeaderClick} />
            </tr>
          </thead>
          <tbody>
            {sortedBomLines.map(l => {
              const recorded = l.consumedLots.reduce((s, x) => s + Number(x.qty_used || 0), 0);
              // Required qty scales to ACTUAL when an override is active, so
              // coverage % reflects what the floor really needs to consume.
              const required = scaledQty(l);
              const covered = required > 0 && recorded >= required - 0.001;
              const partial = !covered && recorded > 0;
              // Per-actual-batch qty for the "Single batch" column. Uses the
              // override's batch count when set, falls back to the plan.
              const qtyPerActualBatch = effectiveNOfBatches > 0 ? required / effectiveNOfBatches : required;
              const lotsLabel = l.consumedLots.length === 0
                ? null
                : l.consumedLots
                    .map(x => `${x.batch_number} (${formatQty(x.qty_used, x.unit)} ${x.unit})`)
                    .join(", ");
              // Faded category-colour tint — ~12% opacity so it's a subtle
              // band that helps the eye group like-with-like without
              // overpowering the data. Falls back to white when the category
              // has no colour set.
              const tint = l.categoryColor ? hexToRgba(l.categoryColor, 0.18) : undefined;
              return (
                <tr
                  key={l.componentItemId}
                  onClick={() => openModal(l)}
                  style={{ cursor: "pointer", background: tint }}
                  onMouseEnter={e => (e.currentTarget.style.background = tint
                    ? hexToRgba(l.categoryColor!, 0.32)
                    : "#fafaf9")}
                  onMouseLeave={e => (e.currentTarget.style.background = tint ?? "")}
                  title="Click anywhere on the row to record / edit batches"
                >
                  {/* Sticky-left so this column stays visible while the
                      operator scrolls right to reach Recorded / Action.
                      Background must match the row's category tint (or
                      white) so scrolled-under rows don't bleed through. */}
                  <td style={{
                    position: "sticky", left: 0, zIndex: 4,
                    background: tint ?? "#fff",
                  }}>
                    <div style={{ fontWeight: 600 }}>
                      {/* Stop the row click from firing when the operator wants
                          to drill into the component's item-master page. */}
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); openItemInPopup(l.componentItemId); }}
                        style={{ background: "none", border: "none", padding: 0, textDecoration: "underline", color: "inherit", fontFamily: "inherit", fontSize: "inherit", textAlign: "left", cursor: "pointer" }}
                      >{l.name}</button>
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#78716c" }}>{l.code}</div>
                  </td>
                  <td style={{ textAlign: "right", color: "#78716c", fontFamily: "monospace" }}>
                    {formatQty(qtyPerActualBatch, l.unit)}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>
                    {formatQty(required, l.unit)}
                  </td>
                  <td style={{ color: "#57534e", textTransform: "uppercase", fontSize: "0.7rem", letterSpacing: "0.04em" }}>{l.unit}</td>
                  <td style={{ fontSize: "0.75rem", color: l.grindSize ? "#1c1917" : "#a8a29e", fontFamily: "monospace" }}>
                    {l.grindSize ?? <em style={{ fontFamily: "inherit" }}>—</em>}
                  </td>
                  <td style={{ fontSize: "0.75rem", color: l.lineComment ? "#1c1917" : "#a8a29e", maxWidth: "240px" }}>
                    {l.lineComment ?? <em>—</em>}
                  </td>
                  <td style={{ fontSize: "0.75rem", color: lotsLabel ? "#1c1917" : "#a8a29e", fontFamily: "monospace" }}>
                    {lotsLabel ?? <em style={{ fontFamily: "inherit", color: "#a8a29e" }}>none recorded</em>}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: covered ? "#166534" : partial ? "#854d0e" : "#a8a29e" }}>
                    {recorded > 0 ? formatQty(recorded, l.unit) : "—"}
                    {required > 0 && (
                      <div style={{ fontSize: "0.65rem", fontWeight: 500, marginTop: "0.05rem", opacity: 0.85 }}>
                        {Math.round((recorded / required) * 100)}%
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {/* Visual indicator only — the whole row is clickable.
                        Wrapped so the icon doesn't fire its own row click
                        again (parent already has onClick). When the order
                        is QA-locked the pill turns grey + 🔒 to make the
                        read-only state obvious at a glance. */}
                    <span
                      style={{
                        fontSize: "0.75rem", padding: "0.3rem 0.7rem",
                        background: isLocked ? "#a8a29e" : "#1e3a8a",
                        color: "#fff", borderRadius: "0.375rem", fontWeight: 600,
                        display: "inline-block", whiteSpace: "nowrap",
                      }}
                      aria-hidden
                    >
                      {isLocked
                        ? "🔒 Locked"
                        : l.consumedLots.length > 0 ? "✏️ Edit" : "📝 Record"}
                    </span>
                  </td>
                  {/* Type / Category / Subcat — parked at the right edge so
                      the floor-facing data takes prime real estate. Still
                      sortable via the header. */}
                  <td style={{ fontSize: "0.7rem", color: "#57534e", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                    {l.itemType.replace("_", " ") || "—"}
                  </td>
                  <td style={{ fontSize: "0.75rem", color: "#1c1917", whiteSpace: "nowrap" }}>
                    {l.categoryName ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                        {l.categoryColor && (
                          <span style={{ display: "inline-block", width: "0.5rem", height: "0.5rem", borderRadius: "2px", background: l.categoryColor }} />
                        )}
                        {l.categoryName}
                      </span>
                    ) : <em style={{ color: "#a8a29e" }}>—</em>}
                  </td>
                  <td style={{ fontSize: "0.75rem", color: "#57534e", whiteSpace: "nowrap" }}>
                    {l.subcategoryName || <em style={{ color: "#a8a29e" }}>—</em>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* Totals footer — sums every numeric column. For a clean recipe
              with no rounding the "Single batch" sum equals batchSize and the
              "Total production" sum equals plannedQty (they're proportional
              shares of the recipe by weight). Worth showing so the operator
              can sanity-check the recipe at a glance. */}
          {(() => {
            const sumSingle    = bomLines.reduce((s, l) => s + (effectiveNOfBatches > 0 ? scaledQty(l) / effectiveNOfBatches : scaledQty(l)), 0);
            const sumTotalProd = bomLines.reduce((s, l) => s + scaledQty(l), 0);
            const sumRecorded  = bomLines.reduce((s, l) => s + l.consumedLots.reduce((a, x) => a + Number(x.qty_used || 0), 0), 0);
            return (
              <tfoot style={{ position: "sticky", bottom: 0, background: "#fafaf9", zIndex: 4 }}>
                <tr style={{ background: "#fafaf9", borderTop: "2px solid #d6d3d1", fontWeight: 700 }}>
                  {/* 1: Component — sticky-left to match the data rows so the
                      "Totals" label stays visible during horizontal scroll. */}
                  <td style={{
                    textTransform: "uppercase", fontSize: "0.7rem", letterSpacing: "0.04em", color: "#57534e",
                    position: "sticky", left: 0, zIndex: 5, background: "#fafaf9",
                  }}>Totals</td>
                  {/* 2: Single batch */}
                  <td style={{ textAlign: "right", fontFamily: "monospace", color: "#1c1917" }}>{formatQty(sumSingle, orderUnit)} {orderUnit}</td>
                  {/* 3: Total production */}
                  <td style={{ textAlign: "right", fontFamily: "monospace", color: "#166534" }}>{formatQty(sumTotalProd, orderUnit)} {orderUnit}</td>
                  {/* 4–7: UOM / Mince / BOM notes / Recorded batches */}
                  <td colSpan={4}></td>
                  {/* 8: Recorded total */}
                  <td style={{ textAlign: "right", fontFamily: "monospace", color: sumRecorded > 0 ? "#166534" : "#a8a29e" }}>
                    {sumRecorded > 0 ? `${formatQty(sumRecorded, orderUnit)} ${orderUnit}` : "—"}
                  </td>
                  {/* 9–12: Action / Type / Category / Subcat */}
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            );
          })()}
        </table>
      </div>

      <p style={{ fontSize: "0.75rem", color: "#78716c", margin: "0.25rem 0.25rem 0" }}>
        <strong>Tip.</strong> One BOM line can be split across multiple lots — e.g. if you pull 5 kg of Pork 75CL from lot B-001 and another 3 kg from B-002, record both separately. Drag the modal title bar if you need to see the table behind it.
      </p>

      {/* ── Batch-entry modal ─────────────────────────────────────────────
          The "need X" subtitle scales to the floor's actual when an
          override is active, so the operator records consumption against
          the qty they're really making, not the original plan. */}
      {editing && (() => {
        const editingRequired = scaledQty(editing);
        return (
        <DraggableModal
          title={`📝 Record batches — ${editing.code} ${editing.name}`}
          subtitle={
            <>
              Need <strong>{formatQty(editingRequired, editing.unit)} {editing.unit}</strong> for this order
              {hasOverride && <span style={{ color: "#fde68a", marginLeft: "0.4rem" }}>(actual)</span>}
              {editing.grindSize && <> · grind <strong>{editing.grindSize}</strong></>}
            </>
          }
          accent="#1e3a8a"
          onClose={closeModal}
          width={760}
          footer={
            <>
              <button type="button" onClick={closeModal} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Cancel</button>
              <button type="button" onClick={save} disabled={isPending} className="btn-primary" style={{ fontSize: "0.8125rem" }}>
                {isPending ? "Saving…" : "💾 Save batches"}
              </button>
            </>
          }
        >
          {editing.lineComment && (
            <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "0.375rem", fontSize: "0.75rem", color: "#854d0e" }}>
              <strong>BOM note:</strong> {editing.lineComment}
            </div>
          )}

          <BatchRowsEditor
            draft={draft}
            updateRow={updateRow}
            removeRow={removeRow}
            addRow={addRow}
            onSubmit={save}
          />

          <div style={{ marginTop: "0.5rem" }}>
            <label className="form-label">Notes (optional)</label>
            <input
              className="form-input"
              placeholder="Any observations about these lots…"
              value={draftNotes}
              onChange={e => setDraftNotes(e.target.value)}
            />
          </div>

          {(() => {
            const total = draft.reduce((s, r) => s + (Number(r.qty_used) || 0), 0);
            const diff = total - editingRequired;
            return (
              <div style={{ fontSize: "0.8125rem", padding: "0.5rem 0.75rem", background: "#fafaf9", borderRadius: "0.375rem", display: "flex", justifyContent: "space-between", marginTop: "0.5rem" }}>
                <span>Total entered: <strong style={{ fontFamily: "monospace" }}>{formatQty(total, editing.unit)} {editing.unit}</strong></span>
                <span style={{ color: Math.abs(diff) < 0.01 ? "#166534" : diff > 0 ? "#854d0e" : "#b91c1c" }}>
                  {Math.abs(diff) < 0.01 ? "✓ matches recipe" : diff > 0 ? `+${formatQty(diff, editing.unit)} over` : `${formatQty(-diff, editing.unit)} short`}
                </span>
              </div>
            );
          })()}
        </DraggableModal>
        );
      })()}
    </div>
  );
}

// ─── Sortable column header ──────────────────────────────────────────────────
//
// Click → set this column as the sole sort (cycle asc/desc/none).
// Shift-click → add to the multi-sort stack as a tiebreaker.
// Visual: faint ⇅ at rest, dark ▲/▼ when active, with a tiny priority badge
// when more than one rule is in play so the operator sees the order.

function SortableTh({
  sortKey, label, sortRules, onClick, align = "left", hint, sticky,
}: {
  sortKey: SortKey;
  label: string;
  sortRules: SortRule[];
  onClick: (key: SortKey, shift: boolean) => void;
  align?: "left" | "right";
  hint?: string;
  /** Pin this column to the left/right edge so it stays visible during the
   *  table's horizontal scroll. Used for the Component column on the BOM
   *  table so operators always see what they're recording, even on narrow
   *  tablet viewports. */
  sticky?: "left" | "right";
}) {
  const idx = sortRules.findIndex(r => r.key === sortKey);
  const rule = idx >= 0 ? sortRules[idx] : null;
  const isMulti = sortRules.length > 1;
  // Sticky cells need a solid background so the rows scrolling underneath
  // don't bleed through. zIndex 6 keeps them above sticky-thead (zIndex 5).
  const stickyStyle: React.CSSProperties = sticky
    ? { position: "sticky", left: sticky === "left" ? 0 : undefined, right: sticky === "right" ? 0 : undefined, background: "#fafaf9", zIndex: 6 }
    : {};
  return (
    <th
      onClick={e => onClick(sortKey, e.shiftKey)}
      style={{
        textAlign: align, cursor: "pointer", userSelect: "none",
        whiteSpace: "nowrap",
        ...stickyStyle,
      }}
      title={hint ? `${hint} — Click to sort, Shift-click to add tiebreaker.` : "Click to sort, Shift-click to add tiebreaker."}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
        {label}
        {rule
          ? <span style={{ color: "#b91c1c", fontWeight: 700 }}>{rule.dir === "asc" ? "▲" : "▼"}</span>
          : <span style={{ color: "#d6d3d1", fontWeight: 400 }}>⇅</span>}
        {rule && isMulti && (
          <span style={{ fontSize: "0.6rem", color: "#854d0e", background: "#fef3c7", padding: "0 0.3rem", borderRadius: "9999px", fontWeight: 700 }}>
            {idx + 1}
          </span>
        )}
      </span>
    </th>
  );
}

// ─── Hex → rgba helper ───────────────────────────────────────────────────────
//
// Used to fade category colours into a subtle row tint. Accepts both #RRGGBB
// and #RGB shorthand. Returns a CSS rgba() string. Falls back to white when
// the input is malformed so the table doesn't break on legacy data.

function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  if (h.length !== 6) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── Header info card ────────────────────────────────────────────────────────

function InfoCard({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: "0.5rem", overflow: "hidden" }}>
      <div style={{ padding: "0.5rem 0.75rem", borderBottom: `2px solid ${accent}`, background: "#fafaf9", fontSize: "0.7rem", fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {title}
      </div>
      <div style={{ padding: "0.625rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {children}
      </div>
    </div>
  );
}

function AttrRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === "" || value === 0) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.75rem" }}>
      <span style={{ color: "#78716c" }}>{label}</span>
      <span style={{ color: "#1c1917", fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}

// ─── Batch rows editor (used inside the modal) ───────────────────────────────
//
// Pulled out so the modal stays small and the editor can focus the first
// empty row on mount + handle Enter-to-next-field behaviour without leaking
// into the rest of the modal logic.

function BatchRowsEditor({
  draft, updateRow, removeRow, addRow, onSubmit,
}: {
  draft: ConsumptionLot[];
  updateRow: (idx: number, patch: Partial<ConsumptionLot>) => void;
  removeRow: (idx: number) => void;
  addRow: () => void;
  onSubmit: () => void;
}) {
  // Refs for every batch_number input — used to auto-focus when a new row
  // is added so the operator can keep typing without touching the mouse.
  const batchInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  // Tracks an index we should focus next time the row count grows. Prevents
  // refocus loops when rows are merely edited.
  const [pendingFocusIdx, setPendingFocusIdx] = useState<number | null>(null);

  // Focus the FIRST INCOMPLETE batch_number input on mount. If every row is
  // populated, focus the last one anyway so Tab adds new rows.
  useEffect(() => {
    const firstEmpty = draft.findIndex(r => !r.batch_number.trim());
    const idx = firstEmpty === -1 ? draft.length - 1 : firstEmpty;
    batchInputRefs.current[idx]?.focus();
    batchInputRefs.current[idx]?.select();
    // Run only on mount — drafts changing after that should NOT yank focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When pendingFocusIdx is set (e.g. after Tab/Enter from the last row's
  // unit field), focus that batch input on the next render.
  useEffect(() => {
    if (pendingFocusIdx == null) return;
    const el = batchInputRefs.current[pendingFocusIdx];
    if (el) {
      el.focus();
      el.select();
      setPendingFocusIdx(null);
    }
  }, [pendingFocusIdx, draft.length]);

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>, idx: number, field: "batch" | "qty" | "unit") {
    // Tab on the LAST row's unit field → add a new row + focus its batch input.
    // (Shift-Tab is left alone so the operator can walk backwards naturally.)
    if (e.key === "Tab" && !e.shiftKey && idx === draft.length - 1 && field === "unit") {
      e.preventDefault();
      addRow();
      setPendingFocusIdx(draft.length); // new row's index after the add
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter on the unit field of the LAST row → also add a new row + focus.
      if (idx === draft.length - 1 && field === "unit") {
        addRow();
        setPendingFocusIdx(draft.length);
        return;
      }
      onSubmit();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 80px 32px", gap: "0.5rem", fontSize: "0.65rem", color: "#78716c", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", padding: "0 0.25rem" }}>
        <span>Batch / lot number</span>
        <span style={{ textAlign: "right" }}>Qty used</span>
        <span style={{ textAlign: "center" }}>UOM</span>
        <span></span>
      </div>
      {draft.map((row, idx) => (
        <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 140px 80px 32px", gap: "0.5rem", alignItems: "center" }}>
          <input
            ref={el => { batchInputRefs.current[idx] = el; }}
            placeholder="e.g. B-001"
            value={row.batch_number}
            onChange={e => updateRow(idx, { batch_number: e.target.value })}
            onKeyDown={e => handleKey(e, idx, "batch")}
            className="form-input"
            style={{ fontFamily: "monospace" }}
          />
          <input
            type="number" step="0.001" min={0}
            placeholder="0"
            value={row.qty_used || ""}
            onChange={e => updateRow(idx, { qty_used: Number(e.target.value) || 0 })}
            onKeyDown={e => handleKey(e, idx, "qty")}
            className="form-input"
            style={{ textAlign: "right" }}
          />
          <input
            value={row.unit}
            onChange={e => updateRow(idx, { unit: e.target.value })}
            onKeyDown={e => handleKey(e, idx, "unit")}
            className="form-input"
            style={{ textAlign: "center" }}
          />
          <button
            type="button"
            onClick={() => removeRow(idx)}
            disabled={draft.length === 1}
            title="Remove this row"
            tabIndex={-1}
            style={{ background: "none", border: "none", color: draft.length === 1 ? "#d6d3d1" : "#dc2626", cursor: draft.length === 1 ? "not-allowed" : "pointer", fontSize: "1.1rem", padding: "0.2rem 0.4rem" }}
          >×</button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        tabIndex={-1}
        style={{ background: "none", border: "1px dashed #d6d3d1", color: "#1e3a8a", padding: "0.4rem", borderRadius: "0.375rem", cursor: "pointer", fontSize: "0.8125rem", fontWeight: 600, alignSelf: "flex-start" }}
      >+ Add another lot</button>
    </div>
  );
}

