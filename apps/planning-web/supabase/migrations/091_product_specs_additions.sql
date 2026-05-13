-- ============================================================================
-- 091  PRODUCT_SPECS — additions for the GB Spec / PIF build
-- ----------------------------------------------------------------------------
-- Per Tino's confirmed scope (May 2026):
--   • Single product_specs source of truth → multiple PDF template renders
--     at send time (GB Modern full / GB Modern one-pager / PIF).
--   • Per-field override tracking via field_overrides jsonb so the spec
--     form can show "Auto" vs "Manual (by X on Y)" badges and pass
--     compliance audit.
--   • Multi-component CoO breakdown is a deeper follow-up topic; this
--     migration adds a single text column for now and parks the table.
--
-- Plus: tenants.qa_email — CC on every spec / PIF send (mirrors the PO
-- side's tenants.purchasing_email).
-- ============================================================================

ALTER TABLE public.product_specs
  ADD COLUMN IF NOT EXISTS field_overrides             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS country_of_origin           text,
  ADD COLUMN IF NOT EXISTS ingredients_statement       text,
  ADD COLUMN IF NOT EXISTS heating_instructions        text,
  ADD COLUMN IF NOT EXISTS min_life_on_receival_days   int,
  ADD COLUMN IF NOT EXISTS pack_tare_weight_inner_g    numeric,
  ADD COLUMN IF NOT EXISTS barcode_override            text;

COMMENT ON COLUMN public.product_specs.field_overrides IS
  'Per-field override tracking for auto-pop vs manual-edit distinction. Map of {field_name: {by: uuid, at: iso_ts}}. Auto-pop engine skips fields present here; UI shows "Manual (by X)" badge.';
COMMENT ON COLUMN public.product_specs.country_of_origin IS
  'Declared CoO for the finished product (e.g. "Made in Australia from local and imported ingredients"). Multi-component CoO breakdown is a deeper topic for a follow-up migration.';
COMMENT ON COLUMN public.product_specs.ingredients_statement IS
  'Rendered ingredients line as it appears on the PIF / spec PDF. Auto-built by the BOM walk; operator can edit for compliant phrasing.';
COMMENT ON COLUMN public.product_specs.heating_instructions IS
  'Reheating / cook-from-frozen guidance shown on the spec PDF.';
COMMENT ON COLUMN public.product_specs.min_life_on_receival_days IS
  'Minimum Life On Receival (MLOR) — days of remaining shelf life the customer requires at delivery. Retailer-driven (e.g. Coles 28 days).';
COMMENT ON COLUMN public.product_specs.pack_tare_weight_inner_g IS
  'Tare weight of the inner pack in grams. Separate from items.tare_weight_g which is the per-piece tare.';
COMMENT ON COLUMN public.product_specs.barcode_override IS
  'When this spec version uses a different barcode than items.barcode. NULL = use items.barcode.';

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS qa_email text;

COMMENT ON COLUMN public.tenants.qa_email IS
  'Central CC address for every spec / PIF email send (e.g. qa@germanbutchery.com.au).';
