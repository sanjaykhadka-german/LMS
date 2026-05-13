-- ============================================================================
-- 060  GIVEAWAY % + AUTO-DERIVED PACK QUANTITIES
-- ----------------------------------------------------------------------------
-- Two related changes per Tino:
--
-- 1. Giveaway: drop per-piece grams, switch to a percentage of the target
--    weight. Comparable across products of any size; easier to benchmark and
--    set tenant-wide targets ("we accept 2% giveaway max").
--
--    `giveaway_g` removed. `giveaway_pct` added (0–100, numeric).
--
-- 2. Pieces/Outer and Pieces/Pallet are now AUTO-DERIVED from the leaves and
--    written by trigger on insert/update. The operator enters:
--      pieces_per_inner   (units_per_inner)
--      inners_per_outer   (inner_per_outer)
--      outers_per_pallet  (NEW in migration 058)
--    The trigger fills:
--      units_per_outer  = units_per_inner * inner_per_outer
--      units_per_pallet = units_per_outer * outers_per_pallet
--                       = units_per_inner * inner_per_outer * outers_per_pallet
--
--    NULL leaves → NULL derived (we don't fabricate values).
--    The previous column-level CHECK constraints (>0) are loosened so the
--    trigger can write the computed value freely.
-- ============================================================================

-- ── (1) Giveaway: drop grams, add percentage ────────────────────────────────
ALTER TABLE public.items
  DROP CONSTRAINT IF EXISTS items_giveaway_g_chk;
ALTER TABLE public.items
  DROP COLUMN IF EXISTS giveaway_g;

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS giveaway_pct numeric;

ALTER TABLE public.items
  DROP CONSTRAINT IF EXISTS items_giveaway_pct_chk,
  ADD  CONSTRAINT items_giveaway_pct_chk CHECK (giveaway_pct IS NULL OR (giveaway_pct >= 0 AND giveaway_pct <= 100));

COMMENT ON COLUMN public.items.giveaway_pct IS 'Typical giveaway as a percentage of target_weight_g (0–100). E.g. 2.0 = 2% of pack weight goes out as overpack.';

-- ── (2) Auto-derived pack qtys via trigger ──────────────────────────────────
--
-- Trigger fires BEFORE INSERT or UPDATE OF the pack-leaf columns, recalculating
-- units_per_outer + units_per_pallet from the current row state. This way:
--   - Direct DB writes (Supabase Studio, SQL scripts) stay consistent
--   - The app can stop sending units_per_outer/units_per_pallet entirely
--   - Reports / MRP queries reading these columns always get fresh values

CREATE OR REPLACE FUNCTION public.items_recalc_pack_qtys()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Pieces per Outer = Pieces/Inner × Inners/Outer
  IF NEW.units_per_inner IS NOT NULL AND NEW.inner_per_outer IS NOT NULL THEN
    NEW.units_per_outer := NEW.units_per_inner * NEW.inner_per_outer;
  ELSE
    NEW.units_per_outer := NULL;
  END IF;

  -- Pieces per Pallet = Pieces/Outer × Outers/Pallet
  IF NEW.units_per_outer IS NOT NULL AND NEW.outers_per_pallet IS NOT NULL THEN
    NEW.units_per_pallet := NEW.units_per_outer * NEW.outers_per_pallet;
  ELSE
    NEW.units_per_pallet := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS items_pack_qtys_trg ON public.items;
CREATE TRIGGER items_pack_qtys_trg
  BEFORE INSERT OR UPDATE OF units_per_inner, inner_per_outer, outers_per_pallet
  ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.items_recalc_pack_qtys();

-- Backfill existing rows so derived values are correct under the new rules
UPDATE public.items
SET units_per_outer = CASE
      WHEN units_per_inner IS NOT NULL AND inner_per_outer IS NOT NULL
        THEN units_per_inner * inner_per_outer
      ELSE NULL
    END;

UPDATE public.items
SET units_per_pallet = CASE
      WHEN units_per_outer IS NOT NULL AND outers_per_pallet IS NOT NULL
        THEN units_per_outer * outers_per_pallet
      ELSE NULL
    END;
