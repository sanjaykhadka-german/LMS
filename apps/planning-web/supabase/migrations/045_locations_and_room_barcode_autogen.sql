-- ============================================================================
-- 045 LOCATIONS REGISTER + AUTO-GENERATED ROOM/LOCATION BARCODES
-- ----------------------------------------------------------------------------
-- 1. Adds public.generate_short_code(prefix) helper (base32, no confusables)
-- 2. Adds BEFORE INSERT triggers on rooms + locations to auto-fill barcode
--    when blank (RM-XXXXXX / LOC-XXXXXX).
-- 3. Backfills any existing rooms with null barcode.
-- 4. Sets rooms.department_id NOT NULL (it's already 100% populated).
-- 5. Creates public.locations table (Tenant -> Department -> Room -> Location)
--    with RLS, indexes, updated_at trigger and tenant-scoped barcode unique.
-- ============================================================================

-- ---- 1. Short-code generator ------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_short_code(prefix text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  -- Crockford base32 minus confusable chars (0/O, 1/I, etc.)
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i integer;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  END LOOP;
  RETURN prefix || '-' || result;
END;
$$;

-- ---- 2. Rooms auto-barcode trigger -----------------------------------------
CREATE OR REPLACE FUNCTION public.rooms_autogen_barcode()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attempts integer := 0;
  candidate text;
BEGIN
  IF NEW.barcode IS NULL OR length(trim(NEW.barcode)) = 0 THEN
    LOOP
      candidate := public.generate_short_code('RM');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.rooms WHERE tenant_id = NEW.tenant_id AND barcode = candidate
      );
      attempts := attempts + 1;
      IF attempts > 20 THEN
        RAISE EXCEPTION 'Could not generate unique room barcode after 20 attempts';
      END IF;
    END LOOP;
    NEW.barcode := candidate;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_autogen_barcode_trg ON public.rooms;
CREATE TRIGGER rooms_autogen_barcode_trg
  BEFORE INSERT ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.rooms_autogen_barcode();

-- ---- 3. Backfill any existing room without a barcode -----------------------
DO $$
DECLARE
  r record;
  candidate text;
  attempts integer;
BEGIN
  FOR r IN SELECT id, tenant_id FROM public.rooms WHERE barcode IS NULL OR length(trim(barcode)) = 0 LOOP
    attempts := 0;
    LOOP
      candidate := public.generate_short_code('RM');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.rooms WHERE tenant_id = r.tenant_id AND barcode = candidate
      );
      attempts := attempts + 1;
      EXIT WHEN attempts > 20;
    END LOOP;
    UPDATE public.rooms SET barcode = candidate WHERE id = r.id;
  END LOOP;
END $$;

-- ---- 4. rooms.department_id NOT NULL ---------------------------------------
ALTER TABLE public.rooms ALTER COLUMN department_id SET NOT NULL;

-- ---- 5. Locations table ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  description text,
  barcode text,
  color text,
  sort_order integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_locations_tenant ON public.locations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_locations_room   ON public.locations(room_id);
CREATE INDEX IF NOT EXISTS idx_locations_barcode ON public.locations(barcode);

CREATE UNIQUE INDEX IF NOT EXISTS locations_tenant_barcode_uniq
  ON public.locations(tenant_id, barcode) WHERE barcode IS NOT NULL;

COMMENT ON TABLE public.locations IS 'Sub-zones inside rooms (e.g. shelf, bin, rack). Each location belongs to exactly one room and inherits its department. Has its own scannable barcode for stocktake / put-away workflows.';

-- ---- 6. updated_at touch helper (idempotent) -------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS locations_touch_updated_at_trg ON public.locations;
CREATE TRIGGER locations_touch_updated_at_trg
  BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---- 7. Locations auto-barcode trigger -------------------------------------
CREATE OR REPLACE FUNCTION public.locations_autogen_barcode()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attempts integer := 0;
  candidate text;
BEGIN
  IF NEW.barcode IS NULL OR length(trim(NEW.barcode)) = 0 THEN
    LOOP
      candidate := public.generate_short_code('LOC');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.locations WHERE tenant_id = NEW.tenant_id AND barcode = candidate
      );
      attempts := attempts + 1;
      IF attempts > 20 THEN
        RAISE EXCEPTION 'Could not generate unique location barcode after 20 attempts';
      END IF;
    END LOOP;
    NEW.barcode := candidate;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS locations_autogen_barcode_trg ON public.locations;
CREATE TRIGGER locations_autogen_barcode_trg
  BEFORE INSERT ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.locations_autogen_barcode();

-- ---- 8. RLS ---------------------------------------------------------------
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS locations_select ON public.locations;
CREATE POLICY locations_select ON public.locations
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS locations_insert ON public.locations;
CREATE POLICY locations_insert ON public.locations
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    AND public.is_manager_or_above()
  );

DROP POLICY IF EXISTS locations_update ON public.locations;
CREATE POLICY locations_update ON public.locations
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    AND public.is_manager_or_above()
  );

DROP POLICY IF EXISTS locations_delete ON public.locations;
CREATE POLICY locations_delete ON public.locations
  FOR DELETE TO authenticated
  USING (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    AND public.is_manager_or_above()
  );
