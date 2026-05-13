-- ── Migration 039 — invoice branding & template selection ───────────────────

-- 1. Tenant branding & company info (needed for invoice header)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS abn                    text,
  ADD COLUMN IF NOT EXISTS company_phone          text,
  ADD COLUMN IF NOT EXISTS company_email          text,
  ADD COLUMN IF NOT EXISTS billing_address_line1  text,
  ADD COLUMN IF NOT EXISTS billing_address_line2  text,
  ADD COLUMN IF NOT EXISTS billing_city           text,
  ADD COLUMN IF NOT EXISTS billing_state          text,
  ADD COLUMN IF NOT EXISTS billing_postcode       text,
  ADD COLUMN IF NOT EXISTS billing_country        text DEFAULT 'Australia',
  ADD COLUMN IF NOT EXISTS logo_url               text,
  ADD COLUMN IF NOT EXISTS brand_color            text NOT NULL DEFAULT '#b91c1c',
  ADD COLUMN IF NOT EXISTS invoice_template_id    text NOT NULL DEFAULT 'classic';

-- Constrain template id to known set (drop old constraint first if rerun)
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_invoice_template_id_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_invoice_template_id_check
  CHECK (invoice_template_id IN ('classic','modern','minimal'));

-- 2. Per-invoice template override (NULL = use tenant default)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS template_id text;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_template_id_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_template_id_check
  CHECK (template_id IS NULL OR template_id IN ('classic','modern','minimal'));

COMMENT ON COLUMN tenants.logo_url            IS 'Path in tenant-branding storage bucket, e.g. {tenantId}/logo-{ts}.png';
COMMENT ON COLUMN tenants.brand_color         IS 'Hex colour (e.g. #b91c1c) used as accent on invoice templates.';
COMMENT ON COLUMN tenants.invoice_template_id IS 'Default invoice template: classic | modern | minimal.';
COMMENT ON COLUMN invoices.template_id        IS 'Per-invoice template override. NULL falls back to tenants.invoice_template_id.';

-- NOTE: The "tenant-branding" Supabase Storage bucket must be created via the
-- Supabase dashboard (Storage cannot be created from SQL). Allowed MIME types:
-- image/png, image/jpeg, image/webp, image/svg+xml. Size limit: 2 MB.
