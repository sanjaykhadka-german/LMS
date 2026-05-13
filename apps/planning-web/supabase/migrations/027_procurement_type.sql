-- Migration 027: Add procurement_type to items
-- 'purchase' = we buy it from a supplier
-- 'produce'  = we make it in-house

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS procurement_type text NOT NULL DEFAULT 'purchase'
  CHECK (procurement_type IN ('purchase', 'produce'));

COMMENT ON COLUMN public.items.procurement_type IS 'Whether this item is purchased externally or produced in-house';
