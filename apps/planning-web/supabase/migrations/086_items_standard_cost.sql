-- ============================================================================
-- 086  ITEM STANDARD COST + COST-HEALTH VIEW
-- ----------------------------------------------------------------------------
-- See proposal accepted by Tino May 2026:
--   • items.standard_cost (per items.unit). Auto = MAX(supplier price
--     normalised through purchase_uom_qty). Admin override stamps
--     standard_cost_override_at/_by so we can tell auto from manual.
--   • v_item_cost_health: per-item snapshot with min/max supplier price
--     (normalised), supplier ids at those extremes, and is_below_cheapest
--     flag for the items-grid red-line.
-- ============================================================================

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS standard_cost            numeric,
  ADD COLUMN IF NOT EXISTS standard_cost_override_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS standard_cost_override_at timestamptz;

COMMENT ON COLUMN public.items.standard_cost IS
  'Per items.unit standard cost. Auto = MAX(supplier_items.unit_price normalised through purchase_uom_qty) unless an admin override is set (see standard_cost_override_at).';
COMMENT ON COLUMN public.items.standard_cost_override_by IS
  'Profile that manually set standard_cost. Null = auto-calculated from supplier prices.';
COMMENT ON COLUMN public.items.standard_cost_override_at IS
  'When the admin override was set. Used to tell auto from manual standard_cost values.';

CREATE INDEX IF NOT EXISTS idx_supplier_items_item_id_active
  ON public.supplier_items (item_id);

CREATE OR REPLACE VIEW public.v_item_cost_health AS
WITH normalised AS (
  SELECT
    si.item_id,
    si.supplier_id,
    si.unit_price,
    si.currency,
    CASE
      WHEN si.purchase_uom_qty IS NOT NULL AND si.purchase_uom_qty > 0
        THEN si.unit_price / si.purchase_uom_qty
      ELSE si.unit_price
    END AS price_per_base_unit,
    si.is_preferred,
    si.price_valid_to
  FROM public.supplier_items si
),
agg AS (
  SELECT
    n.item_id,
    COUNT(*) AS supplier_count,
    MIN(n.price_per_base_unit) AS supplier_min_price,
    MAX(n.price_per_base_unit) AS supplier_max_price,
    (array_agg(n.supplier_id ORDER BY n.price_per_base_unit ASC, n.is_preferred DESC))[1] AS cheapest_supplier_id,
    (array_agg(n.supplier_id ORDER BY n.price_per_base_unit DESC, n.is_preferred DESC))[1] AS highest_supplier_id
  FROM normalised n
  GROUP BY n.item_id
)
SELECT
  i.id AS item_id,
  i.code,
  i.name,
  i.unit,
  i.standard_cost,
  i.standard_cost_override_by,
  i.standard_cost_override_at,
  COALESCE(agg.supplier_count, 0) AS supplier_count,
  agg.supplier_min_price,
  agg.supplier_max_price,
  agg.cheapest_supplier_id,
  agg.highest_supplier_id,
  CASE
    WHEN i.standard_cost IS NOT NULL
     AND agg.supplier_min_price IS NOT NULL
     AND i.standard_cost < agg.supplier_min_price
    THEN TRUE
    ELSE FALSE
  END AS is_below_cheapest
FROM public.items i
LEFT JOIN agg ON agg.item_id = i.id;

COMMENT ON VIEW public.v_item_cost_health IS
  'Per-item costing snapshot: standard_cost vs supplier price aggregates (normalised through purchase_uom_qty). is_below_cheapest drives the items-grid red-line.';

GRANT SELECT ON public.v_item_cost_health TO authenticated;
