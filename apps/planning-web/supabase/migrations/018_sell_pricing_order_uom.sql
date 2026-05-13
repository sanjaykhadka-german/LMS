-- ── Items: sell pricing fields ─────────────────────────────────────────────
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS sell_price_per_inner  numeric,   -- fixed-weight: price per inner pack
  ADD COLUMN IF NOT EXISTS sell_price_per_kg     numeric;   -- random-weight: price per kg

COMMENT ON COLUMN items.sell_price_per_inner IS
  'Fixed-weight items only. Price charged per inner pack (e.g. per 3-pack of chorizo).';
COMMENT ON COLUMN items.sell_price_per_kg IS
  'Random-weight items only. Price charged per kg of actual dispatched weight.';

-- ── customer_order_lines: UOM + weight tracking fields ────────────────────
ALTER TABLE customer_order_lines
  ADD COLUMN IF NOT EXISTS order_uom        text
    CHECK (order_uom IN ('inner','carton','kg')),
  ADD COLUMN IF NOT EXISTS qty_ordered      numeric,
  ADD COLUMN IF NOT EXISTS qty_inners       integer,
  ADD COLUMN IF NOT EXISTS qty_kg_estimated numeric,
  ADD COLUMN IF NOT EXISTS qty_kg_actual    numeric;

COMMENT ON COLUMN customer_order_lines.order_uom IS
  'UOM used when entering the order: inner | carton (fixed-weight), carton | kg (random-weight).';
COMMENT ON COLUMN customer_order_lines.qty_ordered IS
  'Quantity in the order_uom (e.g. 5 if ordered 5 cartons).';
COMMENT ON COLUMN customer_order_lines.qty_inners IS
  'Equivalent inner packs. For fixed-weight this drives billing. NULL for kg-ordered random-weight lines.';
COMMENT ON COLUMN customer_order_lines.qty_kg_estimated IS
  'Random-weight only. Estimated kg = qty_inners × target_weight_g / 1000. Shown as ~ on order confirmation.';
COMMENT ON COLUMN customer_order_lines.qty_kg_actual IS
  'Random-weight only. Actual kg weighed at dispatch. When set, overrides qty_kg for invoicing.';
