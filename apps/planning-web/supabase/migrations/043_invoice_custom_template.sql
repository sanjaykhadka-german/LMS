-- ── Migration 043 — replace 'minimal' with 'custom' free-canvas template ────

-- 1. Migrate any existing 'minimal' selections so the new CHECK constraint
--    doesn't reject them. Tenants on 'minimal' fall back to 'classic'; per-
--    invoice overrides reset to NULL (= use tenant default).
UPDATE tenants  SET invoice_template_id = 'classic' WHERE invoice_template_id = 'minimal';
UPDATE invoices SET template_id = NULL              WHERE template_id = 'minimal';

-- 2. Swap the CHECK constraints to allow 'custom' and disallow 'minimal'.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_invoice_template_id_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_invoice_template_id_check
  CHECK (invoice_template_id IN ('classic','modern','custom'));

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_template_id_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_template_id_check
  CHECK (template_id IS NULL OR template_id IN ('classic','modern','custom'));

-- 3. JSON config for the per-tenant custom template.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS invoice_custom_template jsonb;

COMMENT ON COLUMN tenants.invoice_custom_template IS
  'Free-canvas custom invoice template config. Schema: { version, page, blocks[] } where each block has type/x/y/width/height in PDF points. NULL = ship default starter layout.';
