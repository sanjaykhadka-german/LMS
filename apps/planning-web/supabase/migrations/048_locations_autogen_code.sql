-- ============================================================================
-- 048  AUTO-GENERATED LOCATION CODE (L-NNN per tenant)
-- ----------------------------------------------------------------------------
-- Locations now get a short, human-typeable code automatically (L-001, L-002,
-- ...) per tenant if the user leaves the field blank. The barcode (LOC-XXXXXX)
-- is still separate and used by scanners.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.locations_autogen_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attempts integer := 0;
  candidate text;
  next_n integer;
BEGIN
  IF NEW.code IS NULL OR length(trim(NEW.code)) = 0 THEN
    -- Find the next free L-NNN slot for this tenant
    SELECT COALESCE(MAX(NULLIF(SUBSTRING(code FROM '^L-([0-9]+)$'), '')::int), 0) + 1
      INTO next_n
      FROM public.locations
      WHERE tenant_id = NEW.tenant_id;
    LOOP
      candidate := 'L-' || lpad(next_n::text, 3, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.locations
         WHERE tenant_id = NEW.tenant_id AND code = candidate
      );
      next_n := next_n + 1;
      attempts := attempts + 1;
      IF attempts > 100 THEN
        RAISE EXCEPTION 'Could not generate unique location code after 100 attempts';
      END IF;
    END LOOP;
    NEW.code := candidate;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS locations_autogen_code_trg ON public.locations;
CREATE TRIGGER locations_autogen_code_trg
  BEFORE INSERT ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.locations_autogen_code();

-- Backfill any existing rows with no code (per tenant numbering)
DO $$
DECLARE
  r record;
  next_n integer;
  candidate text;
BEGIN
  FOR r IN SELECT id, tenant_id FROM public.locations
            WHERE code IS NULL OR length(trim(code)) = 0
            ORDER BY tenant_id, created_at
  LOOP
    SELECT COALESCE(MAX(NULLIF(SUBSTRING(code FROM '^L-([0-9]+)$'), '')::int), 0) + 1
      INTO next_n FROM public.locations WHERE tenant_id = r.tenant_id;
    candidate := 'L-' || lpad(next_n::text, 3, '0');
    UPDATE public.locations SET code = candidate WHERE id = r.id;
  END LOOP;
END $$;
