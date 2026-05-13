-- ============================================================================
-- 058  PACK HIERARCHY EXTENSION + GIVEAWAY
-- ----------------------------------------------------------------------------
-- Per Tino: clarify the packaging hierarchy and add giveaway tracking.
--
-- Current pack columns (kept, only the LABELS change in the UI):
--   units_per_inner      → "Pieces per Inner"
--   inner_per_outer      → "Inners per Outer"
--   units_per_outer      → "Pieces per Outer"
--
-- New columns:
--   outers_per_pallet    integer — how many outer cartons fit on a pallet.
--   units_per_pallet     integer — pieces per pallet (stored override; can be
--                                  derived = pieces_per_outer × outers_per_pallet).
--   giveaway_g           numeric — typical giveaway grams per piece.
--                                  Set this for fixed-weight packs that overshoot
--                                  target slightly. Drives a future cost
--                                  calculation (giveaway × pieces × $/kg).
--
-- Why store pieces_per_outer / pieces_per_pallet AS WELL AS the leaves?
-- Most packs are clean (4 × 6 × 90 = 2160), but a few are odd (e.g. mixed
-- pallets) where the math doesn't apply. Storing both lets us default to
-- the computed value while letting the operator override per item.
--
-- All new columns are nullable — existing items keep working unchanged.
-- ============================================================================

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS outers_per_pallet integer,
  ADD COLUMN IF NOT EXISTS units_per_pallet  integer,
  ADD COLUMN IF NOT EXISTS giveaway_g        numeric;

COMMENT ON COLUMN public.items.outers_per_pallet IS 'Number of outer cartons per pallet';
COMMENT ON COLUMN public.items.units_per_pallet  IS 'Pieces per pallet — defaults to units_per_outer × outers_per_pallet, override here for mixed/odd pallets';
COMMENT ON COLUMN public.items.giveaway_g        IS 'Typical giveaway grams per piece — used for cost-of-giveaway calculations';

-- Sanity check constraints — non-negative, no zeros (zeros mean "not set")
ALTER TABLE public.items
  DROP CONSTRAINT IF EXISTS items_outers_per_pallet_chk,
  ADD  CONSTRAINT items_outers_per_pallet_chk CHECK (outers_per_pallet IS NULL OR outers_per_pallet > 0);
ALTER TABLE public.items
  DROP CONSTRAINT IF EXISTS items_units_per_pallet_chk,
  ADD  CONSTRAINT items_units_per_pallet_chk CHECK (units_per_pallet IS NULL OR units_per_pallet > 0);
ALTER TABLE public.items
  DROP CONSTRAINT IF EXISTS items_giveaway_g_chk,
  ADD  CONSTRAINT items_giveaway_g_chk CHECK (giveaway_g IS NULL OR giveaway_g >= 0);
