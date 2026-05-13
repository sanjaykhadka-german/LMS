-- ============================================================================
-- 059  FILL WEIGHT + PROCESS LOSS
-- ----------------------------------------------------------------------------
-- Per Tino: track fill weight (what we put in at the filling station) vs
-- target weight (what the finished pack ships at). The difference is process
-- loss — cooking, breakage, machinery waste, etc. — and we need this to
-- correctly size production batches.
--
-- Three tightly-related fields:
--   fill_weight_g     → grams put in per piece at filling
--   target_weight_g   → existing column; grams in the finished pack
--   process_loss_pct  → derived: (fill - target) / fill × 100
--
-- All three are stored. The form keeps them consistent: enter any 2, the
-- third auto-computes. Operator can override any of them; the DB never
-- enforces the math (because real-world variance + manual rounding mean
-- the math is approximate anyway).
--
-- Both are nullable — only matters for fixed-weight WIPF/FG items.
-- ============================================================================

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS fill_weight_g    numeric,
  ADD COLUMN IF NOT EXISTS process_loss_pct numeric;

COMMENT ON COLUMN public.items.fill_weight_g    IS 'Grams filled per piece at the filling station, before cooking/processing';
COMMENT ON COLUMN public.items.process_loss_pct IS 'Process loss as a percentage of fill weight (cook, breakage, machinery waste). 0–100.';

-- Sanity checks: no negatives, loss between 0 and 100
ALTER TABLE public.items
  DROP CONSTRAINT IF EXISTS items_fill_weight_g_chk,
  ADD  CONSTRAINT items_fill_weight_g_chk CHECK (fill_weight_g IS NULL OR fill_weight_g >= 0);
ALTER TABLE public.items
  DROP CONSTRAINT IF EXISTS items_process_loss_pct_chk,
  ADD  CONSTRAINT items_process_loss_pct_chk CHECK (process_loss_pct IS NULL OR (process_loss_pct >= 0 AND process_loss_pct <= 100));
