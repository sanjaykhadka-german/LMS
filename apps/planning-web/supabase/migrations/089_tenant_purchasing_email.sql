-- ============================================================================
-- 089  TENANT — purchasing email + (optional) custom email send domain
-- ----------------------------------------------------------------------------
-- For PO send-out:
--   • purchasing_email — central CC on every PO email send.
--   • email_send_domain — Phase 2 advanced setting. NULL = use platform's
--     shared Resend domain (zero per-tenant setup; works for self-signup
--     trials). Set when a tenant has verified their own DNS records.
--
-- default_currency already exists on tenants and is reused as the costing
-- base currency. No new column needed for currency.
-- ============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS purchasing_email   text,
  ADD COLUMN IF NOT EXISTS email_send_domain  text;

COMMENT ON COLUMN public.tenants.purchasing_email IS
  'Central CC address for every PO email send (e.g. purchasing@germanbutchery.com.au).';
COMMENT ON COLUMN public.tenants.email_send_domain IS
  'Phase 2: tenant-verified Resend domain. NULL = use platform shared domain.';
