-- ============================================================================
-- 056  UNITS OF MEASURE REGISTER
-- ----------------------------------------------------------------------------
-- Per-tenant register of unit-of-measure definitions. Items keep storing the
-- text code (items.unit / items.batch_unit / items.purchase_uom) — this
-- register lets the user manage the human-readable name + description + grouping
-- in one place, so renaming "kg" → "Kilograms" changes everywhere it appears.
--
-- Why text-FK (code) instead of uuid-FK on items.unit?
--   - Avoids breaking ~88-column items table with another nullable FK column
--   - Existing import/export pipelines use the text code; staying with text
--     keeps the spreadsheet round-trip working
--   - Renaming the *display name* (units_of_measure.name) propagates without
--     touching items at all — only the code matters for joins
--
-- The unique constraint is on (tenant_id, lower(code)) so "kg" and "KG"
-- collapse to the same row, matching what items already do.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.units_of_measure (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL DEFAULT public.my_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  code         text        NOT NULL,
  name         text        NOT NULL,
  description  text,
  category     text        NOT NULL DEFAULT 'other'
                CHECK (category IN ('weight','count','volume','length','other')),
  is_base      boolean     NOT NULL DEFAULT false,
  is_active    boolean     NOT NULL DEFAULT true,
  sort_order   integer     NOT NULL DEFAULT 100,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS units_of_measure_tenant_code_lower_uniq
  ON public.units_of_measure (tenant_id, lower(code));
CREATE INDEX IF NOT EXISTS units_of_measure_tenant_active_idx
  ON public.units_of_measure (tenant_id, is_active);

-- Auto-bump updated_at
CREATE OR REPLACE FUNCTION public.units_of_measure_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS units_of_measure_updated_at ON public.units_of_measure;
CREATE TRIGGER units_of_measure_updated_at
  BEFORE UPDATE ON public.units_of_measure
  FOR EACH ROW EXECUTE FUNCTION public.units_of_measure_set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.units_of_measure ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS units_of_measure_tenant_isolation ON public.units_of_measure;
CREATE POLICY units_of_measure_tenant_isolation
  ON public.units_of_measure
  USING (tenant_id = public.my_tenant_id())
  WITH CHECK (tenant_id = public.my_tenant_id());

-- ── Seed: every distinct UOM currently used in items, per tenant ────────────
-- Pulls the text codes from items.unit + batch_unit + purchase_uom (case-
-- insensitive), then inserts one row per tenant per code. The display name
-- defaults to a Title-Cased version of the code; the user can edit it later
-- via the Settings → Units of Measure page.
WITH used AS (
  SELECT i.tenant_id, lower(trim(i.unit)) AS code
  FROM public.items i WHERE i.unit IS NOT NULL AND trim(i.unit) <> ''
  UNION
  SELECT i.tenant_id, lower(trim(i.batch_unit))
  FROM public.items i WHERE i.batch_unit IS NOT NULL AND trim(i.batch_unit) <> ''
  UNION
  SELECT i.tenant_id, lower(trim(i.purchase_uom))
  FROM public.items i WHERE i.purchase_uom IS NOT NULL AND trim(i.purchase_uom) <> ''
)
INSERT INTO public.units_of_measure (tenant_id, code, name, category, is_base, sort_order)
SELECT
  u.tenant_id,
  u.code,
  -- Title-cased default name. "kg" → "Kg", "carton" → "Carton", "ltr" → "Ltr".
  -- Operator can rename to "Kilograms" / "Litre" later via the register UI.
  initcap(u.code) AS name,
  -- Best-effort category guess from the code. Anything not matched lands in
  -- 'other' and the user can re-classify in the UI.
  CASE
    WHEN u.code IN ('kg','g','grams','gram','t','tonne','tonnes','lb','oz')                THEN 'weight'
    WHEN u.code IN ('l','ltr','ltrs','litre','litres','liter','liters','ml','cl','gal')    THEN 'volume'
    WHEN u.code IN ('m','cm','mm','km','in','ft','yd')                                     THEN 'length'
    WHEN u.code IN ('ea','each','unit','units','pcs','pc','pair','pairs','ct','count',
                    'box','boxes','carton','cartons','tub','tubs','jar','jars','jarss',
                    'can','cans','tin','tins','bag','bags','bottle','bottles',
                    'roll','rolls','net','nets','caddy','caddies','bundle','bundles',
                    'bucket','buckets','sachet','sachets','cartridge','cartridges',
                    'drum','drums','batch','batches','sleeve','sleeves')                   THEN 'count'
    ELSE 'other'
  END AS category,
  -- Mark kg as the base weight unit by default
  CASE WHEN u.code = 'kg' THEN true ELSE false END AS is_base,
  -- Sort: weights first, counts second, the rest by alphabetical
  CASE
    WHEN u.code = 'kg' THEN 1
    WHEN u.code IN ('g','grams','gram') THEN 2
    WHEN u.code IN ('l','ltr','litre','litres') THEN 10
    WHEN u.code IN ('ea','each','unit') THEN 20
    ELSE 100
  END AS sort_order
FROM used u
ON CONFLICT (tenant_id, lower(code)) DO NOTHING;
