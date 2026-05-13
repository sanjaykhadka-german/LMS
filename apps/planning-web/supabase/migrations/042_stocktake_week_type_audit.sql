-- ============================================================
-- Migration 042 — Stocktake enhancements
-- Adds: week_commencing, stocktake_type, per-line counted_at + counted_by
-- ============================================================

ALTER TABLE public.stocktakes
  ADD COLUMN IF NOT EXISTS week_commencing date,
  ADD COLUMN IF NOT EXISTS stocktake_type  text NOT NULL DEFAULT 'raw_material';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stocktakes_type_check') THEN
    ALTER TABLE public.stocktakes
      ADD CONSTRAINT stocktakes_type_check
      CHECK (stocktake_type IN ('raw_material','wip','fg','mixed'));
  END IF;
END$$;

COMMENT ON COLUMN public.stocktakes.week_commencing IS
  'Monday of the week this stocktake belongs to.';
COMMENT ON COLUMN public.stocktakes.stocktake_type IS
  'Scope: raw_material (RM+packaging), wip, fg, mixed.';

CREATE INDEX IF NOT EXISTS stocktakes_week_idx ON public.stocktakes(week_commencing);
CREATE INDEX IF NOT EXISTS stocktakes_type_idx ON public.stocktakes(stocktake_type);

ALTER TABLE public.stocktake_lines
  ADD COLUMN IF NOT EXISTS counted_at timestamptz,
  ADD COLUMN IF NOT EXISTS counted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.touch_stocktake_line()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.counted_qty IS NOT NULL THEN
      NEW.counted_at := now();
      NEW.counted_by := COALESCE(NEW.counted_by, auth.uid());
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.counted_qty IS DISTINCT FROM OLD.counted_qty THEN
      NEW.counted_at := now();
      NEW.counted_by := COALESCE(NEW.counted_by, auth.uid());
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_touch_stocktake_line ON public.stocktake_lines;
CREATE TRIGGER trg_touch_stocktake_line
  BEFORE INSERT OR UPDATE ON public.stocktake_lines
  FOR EACH ROW EXECUTE FUNCTION public.touch_stocktake_line();
