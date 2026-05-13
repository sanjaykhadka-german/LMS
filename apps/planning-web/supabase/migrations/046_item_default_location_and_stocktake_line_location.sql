-- ============================================================================
-- 046  ITEM DEFAULT LOCATION + STOCKTAKE LINE LOCATION
-- ----------------------------------------------------------------------------
-- Adds nullable FK columns so stocktake count sheets can show Room/Location
-- per line and so an item can carry a "where it normally lives" hint.
-- All FKs are nullable, ON DELETE SET NULL so location/room deletion never
-- breaks history.
-- ============================================================================

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS default_location_id uuid
    REFERENCES public.locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_items_default_location
  ON public.items(default_location_id);

COMMENT ON COLUMN public.items.default_location_id IS
  'Where this item normally lives. Stocktake lines created for this item default to this location, so Room/Location columns show data without scanning.';

ALTER TABLE public.stocktake_lines
  ADD COLUMN IF NOT EXISTS location_id uuid
    REFERENCES public.locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stocktake_lines_location
  ON public.stocktake_lines(location_id);

COMMENT ON COLUMN public.stocktake_lines.location_id IS
  'The physical location this count was taken at. Defaults to items.default_location_id when a line is created. Will be settable via barcode-scan workflow later.';

-- Trigger: when a new stocktake_line is inserted with no location_id but the
-- item has a default, copy it across. Lightweight; runs once per insert.
CREATE OR REPLACE FUNCTION public.stocktake_line_default_location()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.location_id IS NULL THEN
    SELECT default_location_id INTO NEW.location_id
      FROM public.items WHERE id = NEW.item_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stocktake_line_default_location_trg ON public.stocktake_lines;
CREATE TRIGGER stocktake_line_default_location_trg
  BEFORE INSERT ON public.stocktake_lines
  FOR EACH ROW EXECUTE FUNCTION public.stocktake_line_default_location();
