-- ============================================================================
-- 100  product_specs — Country of Origin breakdown toggle
-- ----------------------------------------------------------------------------
-- Phase 3H.5 v2 (Tino May 2026): the spec editor now ships a CoO panel that
-- visualises the local-vs-imported share, country breakdown, and per-
-- ingredient origins (all derived live from ingredient_components.country_
-- of_origin via the BOM walk). This single boolean controls whether that
-- breakdown is also printed on the customer-facing spec PDF; default OFF
-- so existing customers see exactly the same one-line FSC statement they
-- always have. Toggling ON prints the % bar + country list under the CoO
-- statement on the rendered spec sheet.
-- ============================================================================

ALTER TABLE public.product_specs
  ADD COLUMN IF NOT EXISTS coo_show_breakdown boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.product_specs.coo_show_breakdown IS
  'When TRUE the customer-facing spec PDF prints the CoO breakdown (local % bar + country list + per-ingredient origins) under the FSC CoO statement. Default FALSE → only the one-line statement prints, matching legacy behaviour.';
