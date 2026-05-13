-- ============================================================================
-- 047  STOCKTAKE LINE: BATCH / UBD / SOURCE — TENANT + LOCATION REQUIRE FLAGS
-- ----------------------------------------------------------------------------
-- This migration enables the "tree" stocktake flow:
--   * Each scan or manual entry creates one stocktake_lines row.
--   * The same item can appear multiple times (different location/batch/UBD).
--   * Optional batch / UBD per row, with require flags at tenant or location level.
-- ============================================================================

-- ── stocktake_lines: per-entry data ────────────────────────────────────────
ALTER TABLE public.stocktake_lines
  ADD COLUMN IF NOT EXISTS batch        text,
  ADD COLUMN IF NOT EXISTS ubd          date,
  ADD COLUMN IF NOT EXISTS entry_source text NOT NULL DEFAULT 'manual'
    CHECK (entry_source IN ('manual','scan','pick','import'));

CREATE INDEX IF NOT EXISTS idx_stocktake_lines_item ON public.stocktake_lines(stocktake_id, item_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_lines_batch ON public.stocktake_lines(batch) WHERE batch IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stocktake_lines_ubd ON public.stocktake_lines(ubd) WHERE ubd IS NOT NULL;

COMMENT ON COLUMN public.stocktake_lines.batch IS
  'Production lot / batch identifier observed at this scan. Optional unless tenant or location forces it.';
COMMENT ON COLUMN public.stocktake_lines.ubd IS
  'Use-by-date observed at this scan. Optional unless tenant or location forces it.';
COMMENT ON COLUMN public.stocktake_lines.entry_source IS
  'How this row was created: manual entry, scan, picker bulk-add, or import.';

-- ── tenants: workspace-wide compliance flags ───────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS require_batch boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_ubd   boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.require_batch IS
  'When true, every stocktake / goods-in entry must have a batch number. Locations can still relax this with a NULL override; an explicit FALSE override on a location does NOT relax tenant-wide rules — the tenant flag is the ceiling.';
COMMENT ON COLUMN public.tenants.require_ubd IS
  'When true, every stocktake / goods-in entry must have a use-by date.';

-- ── locations: per-location override ───────────────────────────────────────
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS require_batch boolean,
  ADD COLUMN IF NOT EXISTS require_ubd   boolean;

COMMENT ON COLUMN public.locations.require_batch IS
  'Override for the tenant.require_batch flag at this location. NULL = inherit tenant. TRUE = always require batch here even if tenant doesn''t. FALSE = (ignored if tenant requires) relax requirement at this location only.';
COMMENT ON COLUMN public.locations.require_ubd IS
  'Override for tenant.require_ubd at this location. Same semantics as require_batch.';

-- ── Helper view: effective requirement per location ────────────────────────
CREATE OR REPLACE VIEW public.location_compliance AS
SELECT
  l.id            AS location_id,
  l.tenant_id,
  COALESCE(l.require_batch, t.require_batch) AS require_batch,
  COALESCE(l.require_ubd,   t.require_ubd)   AS require_ubd
FROM public.locations l
JOIN public.tenants t ON t.id = l.tenant_id;
