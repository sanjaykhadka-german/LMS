-- =====================================================================
-- 138_pricing_multi_uom.sql
-- Pricing supports kg | ea | inner | outer | pallet per (item, group).
--
-- Schema gaps closed:
--   items.default_sell_uom         — natural sell UOM for the item
--   customers.default_sell_uom     — customer's UOM preference (overrides item)
--   price_group_lines.unit         — UOM the unit_price is denominated in
--   convert_item_qty(...)          — helper RPC using existing pack hierarchy
--
-- Backfill:
--   items: 'outer' for fixed-weight items with units_per_outer set; else 'kg'.
--   price_group_lines: 'kg' (legacy assumption — Tino can edit per-line later).
-- =====================================================================

-- 1) Columns -----------------------------------------------------------
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS default_sell_uom TEXT
  CHECK (default_sell_uom IS NULL OR default_sell_uom IN ('kg','ea','inner','outer','pallet'));
COMMENT ON COLUMN items.default_sell_uom IS
  'Natural sell UOM. Sales-order entry and pricing-matrix display default to this. NULL = kg.';

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS default_sell_uom TEXT
  CHECK (default_sell_uom IS NULL OR default_sell_uom IN ('kg','ea','inner','outer','pallet'));
COMMENT ON COLUMN customers.default_sell_uom IS
  'Per-customer UOM preference. Overrides items.default_sell_uom at order entry. NULL = use item default.';

ALTER TABLE price_group_lines
  ADD COLUMN IF NOT EXISTS unit TEXT
  CHECK (unit IS NULL OR unit IN ('kg','ea','inner','outer','pallet'));
COMMENT ON COLUMN price_group_lines.unit IS
  'UOM that unit_price is denominated in. Eg unit=outer + unit_price=96.00 means $96 per outer.';

-- 2) Backfill ----------------------------------------------------------
UPDATE items
SET default_sell_uom = CASE
  WHEN weight_mode = 'random'                                  THEN 'kg'
  WHEN units_per_outer IS NOT NULL AND units_per_outer > 0     THEN 'outer'
  WHEN units_per_inner IS NOT NULL AND units_per_inner > 0     THEN 'inner'
  WHEN target_weight_g IS NOT NULL AND target_weight_g > 0     THEN 'ea'
  ELSE 'kg'
END
WHERE default_sell_uom IS NULL;

UPDATE price_group_lines SET unit = 'kg' WHERE unit IS NULL;

-- 3) Conversion helper ------------------------------------------------
CREATE OR REPLACE FUNCTION convert_item_qty(
  p_item_id  UUID,
  p_qty      NUMERIC,
  p_from_uom TEXT,
  p_to_uom   TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  i RECORD;
  target_g NUMERIC;
  qty_pieces NUMERIC;
BEGIN
  IF p_qty IS NULL THEN RETURN NULL; END IF;
  IF p_from_uom = p_to_uom THEN RETURN p_qty; END IF;

  SELECT target_weight_g, fill_weight_g, units_per_inner, units_per_outer, units_per_pallet, weight_mode
  INTO i
  FROM items
  WHERE id = p_item_id AND tenant_id = my_tenant_id();
  IF NOT FOUND THEN RETURN NULL; END IF;

  target_g := COALESCE(NULLIF(i.fill_weight_g, 0), NULLIF(i.target_weight_g, 0));

  qty_pieces := CASE p_from_uom
    WHEN 'ea'     THEN p_qty
    WHEN 'inner'  THEN p_qty * NULLIF(i.units_per_inner, 0)
    WHEN 'outer'  THEN p_qty * NULLIF(i.units_per_outer, 0)
    WHEN 'pallet' THEN p_qty * NULLIF(i.units_per_pallet, 0)
    WHEN 'kg'     THEN CASE WHEN target_g IS NULL THEN NULL ELSE p_qty * 1000.0 / target_g END
    ELSE NULL
  END;
  IF qty_pieces IS NULL THEN RETURN NULL; END IF;

  RETURN CASE p_to_uom
    WHEN 'ea'     THEN qty_pieces
    WHEN 'inner'  THEN CASE WHEN NULLIF(i.units_per_inner, 0)  IS NULL THEN NULL ELSE qty_pieces / i.units_per_inner  END
    WHEN 'outer'  THEN CASE WHEN NULLIF(i.units_per_outer, 0)  IS NULL THEN NULL ELSE qty_pieces / i.units_per_outer  END
    WHEN 'pallet' THEN CASE WHEN NULLIF(i.units_per_pallet, 0) IS NULL THEN NULL ELSE qty_pieces / i.units_per_pallet END
    WHEN 'kg'     THEN CASE WHEN target_g IS NULL THEN NULL ELSE qty_pieces * target_g / 1000.0 END
    ELSE NULL
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION convert_item_qty(UUID, NUMERIC, TEXT, TEXT) TO authenticated;
