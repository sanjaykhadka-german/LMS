-- ── Migration 020: Sequential order numbers ──────────────────────────────────
-- Replaces date-based order numbers (ORD-YYMMDD-RRR) with simple ascending
-- integers displayed as #1001, #1002 etc.

ALTER TABLE customer_orders
  ADD COLUMN IF NOT EXISTS order_seq INTEGER;

CREATE SEQUENCE IF NOT EXISTS customer_order_seq START 1001;

-- Populate any existing rows that don't have a seq yet
UPDATE customer_orders
SET order_seq = nextval('customer_order_seq')
WHERE order_seq IS NULL;

-- Trigger: auto-assign seq on insert
CREATE OR REPLACE FUNCTION assign_order_seq()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.order_seq IS NULL THEN
    NEW.order_seq := nextval('customer_order_seq');
    NEW.order_number := NEW.order_seq::text;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_assign_order_seq ON customer_orders;
CREATE TRIGGER trg_assign_order_seq
  BEFORE INSERT ON customer_orders
  FOR EACH ROW EXECUTE FUNCTION assign_order_seq();

COMMENT ON COLUMN customer_orders.order_seq IS
  'Auto-incrementing display number shown as #1001, #1002 etc.';
