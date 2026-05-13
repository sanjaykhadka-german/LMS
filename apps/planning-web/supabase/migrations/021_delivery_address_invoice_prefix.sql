-- ── Migration 021 ────────────────────────────────────────────────────────────

-- 1. Structured delivery address on customers
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS delivery_is_same_as_billing boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS delivery_address_line1 text,
  ADD COLUMN IF NOT EXISTS delivery_address_line2 text,
  ADD COLUMN IF NOT EXISTS delivery_city          text,
  ADD COLUMN IF NOT EXISTS delivery_state         text,
  ADD COLUMN IF NOT EXISTS delivery_postcode      text;

-- 2. Min shelf life on items (product-level, not customer-level)
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS min_shelf_life_days integer;

-- 3. Tenant-level settings
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS invoice_prefix      text    NOT NULL DEFAULT 'INV',
  ADD COLUMN IF NOT EXISTS has_multi_currency  boolean NOT NULL DEFAULT false;

-- 4. Sequential invoice numbers
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_seq integer;

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1001;

UPDATE invoices
  SET invoice_seq = nextval('invoice_number_seq')
  WHERE invoice_seq IS NULL;

CREATE OR REPLACE FUNCTION assign_invoice_seq()
RETURNS TRIGGER AS $$
DECLARE v_prefix text;
BEGIN
  IF NEW.invoice_seq IS NULL THEN
    NEW.invoice_seq := nextval('invoice_number_seq');
    SELECT COALESCE(invoice_prefix, 'INV') INTO v_prefix
      FROM tenants WHERE id = NEW.tenant_id;
    NEW.invoice_number := v_prefix || '-' || lpad(NEW.invoice_seq::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_assign_invoice_seq ON invoices;
CREATE TRIGGER trg_assign_invoice_seq
  BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION assign_invoice_seq();

COMMENT ON COLUMN tenants.invoice_prefix IS 'Prefix for invoice numbers e.g. INV, GB, TAX. Results in INV-01001.';
COMMENT ON COLUMN tenants.has_multi_currency IS 'Show currency selector on orders/invoices. Off by default for domestic-only businesses.';
COMMENT ON COLUMN items.min_shelf_life_days IS 'Minimum shelf life (days) required on dispatch for this product.';
COMMENT ON COLUMN customers.delivery_is_same_as_billing IS 'When true, delivery address = billing address. When false, use the delivery_* fields.';
