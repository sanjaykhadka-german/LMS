-- ============================================================================
-- 063  consumed_in_weight flag on items + basis on bom_lines + cleanup
-- ----------------------------------------------------------------------------
-- Per Tino's design rule (May 2026): items split into two buckets.
--
--   consumed_in_weight = TRUE   →  goes INTO the product weight per Weights
--                                  & Measures rules. Recipe ingredients
--                                  (pork, fat, salt, water, additives, MDM,
--                                  spices). WIP/WIPF/FG themselves count
--                                  as weight as they flow up the chain.
--                                  In a BOM, qty_per_batch is treated as a
--                                  PERCENTAGE of the parent's weight; recipe
--                                  lines should sum to ~100%.
--
--   consumed_in_weight = FALSE  →  packaging, casings, labels, crates, boxes,
--                                  cleaning consumables. Tracked for procurement
--                                  + cost + consumption, but never affects
--                                  weight totals or recipe %. In a BOM, the
--                                  line carries a `basis` (per_piece /
--                                  per_inner / per_outer / per_pallet / per_kg)
--                                  saying what unit-of-parent the qty applies to.
--
-- This single flag drives all downstream BOM math without any per-line
-- mode-switching by the user.
--
-- Also: strip redundant parent-link BOM lines (where a BOM line points to
-- the BOM owner's own parent_item_id). The new explode_mrp pulls 1 kg of
-- parent per 1 kg of child IMPLICITLY from items.parent_item_id, so writing
-- it as a manual BOM line is duplicate.
-- ============================================================================

-- ── (1) items.consumed_in_weight ───────────────────────────────────────────
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS consumed_in_weight boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.items.consumed_in_weight IS
  'TRUE when this item contributes to the product weight per W&M rules (raw materials, WIP/WIPF/FG). FALSE for packaging, casings, labels, consumables.';

-- Backfill: derive from item_type for existing rows
UPDATE public.items
SET consumed_in_weight = CASE
  WHEN item_type IN ('raw_material','wip','wipf','fill','finished_good') THEN true
  WHEN item_type IN ('packaging','consumable')                            THEN false
  ELSE true
END;

CREATE INDEX IF NOT EXISTS idx_items_consumed_in_weight
  ON public.items(consumed_in_weight);

-- ── (2) bom_lines.basis ────────────────────────────────────────────────────
-- NULL  → recipe line (component is consumed_in_weight; qty_per_batch is %)
-- 'per_piece' / 'per_inner' / 'per_outer' / 'per_pallet' / 'per_kg'
--       → packaging/consumable line; qty_per_batch × parent-in-basis-units
ALTER TABLE public.bom_lines
  ADD COLUMN IF NOT EXISTS basis text;

ALTER TABLE public.bom_lines
  DROP CONSTRAINT IF EXISTS bom_lines_basis_chk,
  ADD  CONSTRAINT bom_lines_basis_chk
    CHECK (basis IS NULL OR basis IN ('per_piece','per_inner','per_outer','per_pallet','per_kg'));

COMMENT ON COLUMN public.bom_lines.basis IS
  'For non-weight components: the unit of the parent that qty_per_batch is per. NULL for weight-recipe lines.';

-- Backfill: for any existing line whose component is non-weight, default
-- basis = per_kg with qty_per_batch / 1000 to preserve the legacy "per
-- 1000 kg batch" semantic. Operator can re-enter in their preferred basis.
WITH non_weight_lines AS (
  SELECT bl.id, bl.qty_per_batch
  FROM public.bom_lines bl
  JOIN public.items comp ON comp.id = bl.component_item_id
  WHERE comp.consumed_in_weight = false
    AND bl.basis IS NULL
)
UPDATE public.bom_lines bl
SET
  basis         = 'per_kg',
  qty_per_batch = (nwl.qty_per_batch / 1000.0)
FROM non_weight_lines nwl
WHERE bl.id = nwl.id;

-- ── (3) Strip redundant parent-link BOM lines ──────────────────────────────
-- For every BOM line where the component is the BOM owner's own parent_item_id,
-- delete it — explode_mrp now pulls 1 kg of parent per 1 kg of child implicitly.
DELETE FROM public.bom_lines bl
USING public.bom_headers bh, public.items owner
WHERE bl.bom_header_id = bh.id
  AND bh.item_id = owner.id
  AND owner.parent_item_id IS NOT NULL
  AND bl.component_item_id = owner.parent_item_id;
