-- ── Migration 019: lot_number on customer_order_lines ────────────────────────
-- Stores the lot/batch number recorded at dispatch for traceability.
-- Entered manually or via barcode scanner on the dispatch floor screen.

ALTER TABLE customer_order_lines
  ADD COLUMN IF NOT EXISTS lot_number text;

COMMENT ON COLUMN customer_order_lines.lot_number IS
  'Lot/batch number recorded at dispatch for traceability. Scanned or entered manually on the floor screen.';
