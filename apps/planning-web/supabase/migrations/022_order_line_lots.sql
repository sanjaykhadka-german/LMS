-- ── Migration 022: customer_order_line_lots ─────────────────────────────────
-- Supports multi-lot / multi-batch dispatch traceability per order line.
-- Each row represents one batch/lot dispatched against a customer order line.
-- Replaces the single lot_number column for new dispatches (lot_number kept for history).

CREATE TABLE IF NOT EXISTS customer_order_line_lots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_line_id   uuid        NOT NULL REFERENCES customer_order_lines(id) ON DELETE CASCADE,
  dispatch_uom    text        NOT NULL CHECK (dispatch_uom IN ('inner', 'carton', 'kg')),
  qty_dispatched  numeric(12, 3) NOT NULL,
  batch_number    text,
  use_by_date     date,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customer_order_line_lots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON customer_order_line_lots
  FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Index for fast lookup by order line
CREATE INDEX ON customer_order_line_lots(order_line_id);

-- Summary columns on the line — totalled from lots at dispatch time for easy invoicing
ALTER TABLE customer_order_lines
  ADD COLUMN IF NOT EXISTS dispatch_uom    text,
  ADD COLUMN IF NOT EXISTS qty_dispatched  numeric(12, 3);

COMMENT ON TABLE customer_order_line_lots IS
  'One row per batch/lot dispatched against a customer order line. Supports split batches and mixed UBDs.';
COMMENT ON COLUMN customer_order_line_lots.dispatch_uom IS
  'UOM for this lot entry — defaults to order UOM but can be overridden (e.g. carton order can dispatch in inners).';
COMMENT ON COLUMN customer_order_line_lots.qty_dispatched IS
  'Quantity dispatched in dispatch_uom units.';
COMMENT ON COLUMN customer_order_line_lots.use_by_date IS
  'Use-by / best-before date on this specific lot.';
COMMENT ON COLUMN customer_order_lines.dispatch_uom IS
  'Summary UOM for total dispatched qty — set at dispatch time, used for invoicing.';
COMMENT ON COLUMN customer_order_lines.qty_dispatched IS
  'Total qty dispatched (in dispatch_uom) — summed from lots at dispatch time.';
