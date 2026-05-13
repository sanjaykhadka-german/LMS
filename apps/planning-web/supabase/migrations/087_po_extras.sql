-- ============================================================================
-- 087  PO EXTRAS — show-prices toggle + supplier invoice fields
-- ----------------------------------------------------------------------------
--   • purchase_orders.show_prices_on_printout — operator toggle for whether
--     the printout / email PDF includes unit prices.
--   • purchase_order_lines.supplier_invoice_number / _date — set when matching
--     supplier invoices to delivered lines.
-- ============================================================================

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS show_prices_on_printout boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.purchase_orders.show_prices_on_printout IS
  'When TRUE, the PO printout / email PDF includes unit prices. Operators turn this off for confidential pricing situations.';

ALTER TABLE public.purchase_order_lines
  ADD COLUMN IF NOT EXISTS supplier_invoice_number text,
  ADD COLUMN IF NOT EXISTS supplier_invoice_date   date;

COMMENT ON COLUMN public.purchase_order_lines.supplier_invoice_number IS
  'Supplier-issued invoice reference for THIS line. Set when receiving / matching invoices, not at PO creation.';
COMMENT ON COLUMN public.purchase_order_lines.supplier_invoice_date IS
  'Date on the supplier invoice for this line. Independent of order_date / expected_date on the PO header.';

CREATE INDEX IF NOT EXISTS idx_pol_supplier_invoice_number
  ON public.purchase_order_lines (supplier_invoice_number)
  WHERE supplier_invoice_number IS NOT NULL;
