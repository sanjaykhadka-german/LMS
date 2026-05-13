-- BOM data model: capture entry as natural-language "N × item per M [scope]"
-- so operators stop entering 0.000125 of a roll.
--
-- Storage stays the same:
--   qty_per_batch   — the per-1-of-scope rate (e.g. 0.000125 per inner)
--   basis           — the scope: per_kg, per_unit (was per_piece), per_inner, per_outer, per_pallet
--
-- New column captures the M from the operator's natural input:
--   consume_per_qty — the M ("per 8000 inners" → consume_per_qty = 8000)
--
-- On display we reconstruct: N = qty_per_batch × consume_per_qty
--   "1 cartridge per 8000 inners"  (qty=0.000125, M=8000, scope=per_inner)
--   "1 bin liner per 500 kg"       (qty=0.002,    M=500,  scope=per_kg)
--   "2 clips per 1 unit"           (qty=2,        M=1,    scope=per_unit)
--   "1 liner per 50 units"         (qty=0.02,     M=50,   scope=per_unit)
--
-- Math is unchanged — cascades still read qty_per_batch directly. Existing
-- lines keep working with consume_per_qty = 1 (display = "0.000125 per inner",
-- which is ugly but matches today's behaviour until the line is re-edited
-- through the new form and re-saved with a friendly M).
--
-- A column comment explains the model for anyone poking at the DB directly.

ALTER TABLE bom_lines
  ADD COLUMN IF NOT EXISTS consume_per_qty numeric NOT NULL DEFAULT 1;

COMMENT ON COLUMN bom_lines.consume_per_qty IS
  'The M denominator for natural-language entry. ' ||
  'A line entered as "N × item per M [scope]" stores qty_per_batch = N / M and consume_per_qty = M. ' ||
  'Cascade math reads qty_per_batch as the per-1-of-scope rate; ' ||
  'consume_per_qty exists purely so the operator-friendly N can be reconstructed on display. ' ||
  'Default 1 means legacy "0.000125 per inner" displays as-is until re-saved through the new form.';

-- Sanity constraint: an ingredient line (percentage IS NOT NULL) should always
-- have consume_per_qty = 1 — percentages don't take a denominator.
ALTER TABLE bom_lines
  DROP CONSTRAINT IF EXISTS bom_lines_consume_per_qty_ingredient_check;
ALTER TABLE bom_lines
  ADD CONSTRAINT bom_lines_consume_per_qty_ingredient_check
  CHECK (percentage IS NULL OR consume_per_qty = 1);
