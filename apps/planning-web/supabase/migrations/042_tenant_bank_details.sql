-- ── Migration 042 — tenant bank details ─────────────────────────────────────
-- Bank account fields rendered as a "Payment Details" band on invoice PDFs.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS bank_name           text,
  ADD COLUMN IF NOT EXISTS bank_bsb            text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_account_name   text;

COMMENT ON COLUMN tenants.bank_name           IS 'Bank or financial institution name (e.g., Commonwealth Bank).';
COMMENT ON COLUMN tenants.bank_bsb            IS 'Australian BSB (free-text; e.g., 062-000).';
COMMENT ON COLUMN tenants.bank_account_number IS 'Account number (free-text).';
COMMENT ON COLUMN tenants.bank_account_name   IS 'Legal name on the bank account.';
