-- ============================================================================
-- 094  items.nip_large_item — flag for spec NIP "no serving info" rendering
-- ----------------------------------------------------------------------------
-- Tino May 2026: a sausage pack has a sensible "serves per pack / serving
-- size" on the NIP because the operator can predict how many pieces are in
-- a pack. A whole ham or a chorizo log is random-weight and there's no
-- realistic per-serving breakdown — the NIP should show per-100g only.
--
-- Boolean flag, defaults FALSE (= show servings, the normal case). Operator
-- ticks it on the Item Master form for hams / logs / whole-muscle products.
-- ============================================================================

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS nip_large_item boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.items.nip_large_item IS
  'When TRUE, the spec NIP table shows per-100g only (no "Serves per pack" / "Serving size" lines). Use for whole-muscle products like hams, chorizo logs, etc. where per-serving breakdown is meaningless. Default FALSE = show servings.';
