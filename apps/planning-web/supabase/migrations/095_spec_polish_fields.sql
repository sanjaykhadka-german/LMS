-- ============================================================================
-- 095  product_specs polish — storage class + lab-tested flag
-- ----------------------------------------------------------------------------
-- Tino May 2026: spec form should let the operator pick a storage class
-- (Chilled / Frozen / Ambient) instead of free-text-typing every time, and
-- the spec sheet should print the canonical wording. Plus a single boolean
-- to flip the NIP disclaimer between "Lab tested" and "Theoretical value".
--
-- Storage class is text (not a DB enum) so a tenant can extend the set
-- later without a migration; app code constrains the picker. Existing
-- spec_storage_temp stays as a free-text override field (operator can still
-- type a custom range like "0-4C" if they want).
-- ============================================================================

ALTER TABLE public.product_specs
  ADD COLUMN IF NOT EXISTS storage_class           text,
  ADD COLUMN IF NOT EXISTS nutrition_lab_tested    boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.product_specs.storage_class IS
  'One of: chilled | frozen | ambient | null. Drives canonical storage-temp wording on the spec sheet. NULL = falls back to the free-text spec_storage_temp.';
COMMENT ON COLUMN public.product_specs.nutrition_lab_tested IS
  'When TRUE the spec NIP carries a "Lab tested" badge; when FALSE a "Theoretical value" disclaimer prints under the table. Default FALSE.';
