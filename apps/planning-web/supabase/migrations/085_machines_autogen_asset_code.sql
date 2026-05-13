-- ============================================================================
-- 085  AUTO-GENERATED MACHINE ASSET CODE (per type, per tenant)
-- ----------------------------------------------------------------------------
-- Machines now get a short, type-prefixed asset code automatically when the
-- code field is left blank on insert. Pattern: {3-letter-type-prefix}-NN
-- (zero-padded, per tenant). Examples: MIX-01, MIX-02, SMK-01, TMB-01.
--
-- Operator can still override by typing a code — the trigger only fires when
-- code is null or empty. Same approach as migration 048 (locations_autogen_code).
--
-- Why a DB trigger rather than client-side: works no matter how the row gets
-- inserted (single form, bulk grid, future API calls, manual SQL during a
-- migration). Single source of truth for the numbering.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.machines_autogen_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attempts integer := 0;
  candidate text;
  next_n integer;
  prefix text;
BEGIN
  IF NEW.code IS NULL OR length(trim(NEW.code)) = 0 THEN
    -- 3-letter prefix derived from machine_type. Unknown / null types fall
    -- back to "MCH" so we still get a numbered code.
    prefix := CASE lower(coalesce(NEW.machine_type, ''))
      WHEN 'slicer'                 THEN 'SLC'
      WHEN 'smoker'                 THEN 'SMK'
      WHEN 'oven'                   THEN 'OVN'
      WHEN 'grinder'                THEN 'GRD'
      WHEN 'mixer'                  THEN 'MIX'
      WHEN 'filler'                 THEN 'FIL'
      WHEN 'packer'                 THEN 'PCK'
      WHEN 'sealer'                 THEN 'SEL'
      WHEN 'weigh-price labeller'   THEN 'WPL'
      WHEN 'conveyor'               THEN 'CNV'
      WHEN 'refrigeration unit'     THEN 'REF'
      WHEN 'saw'                    THEN 'SAW'
      WHEN 'brine injector'         THEN 'INJ'
      WHEN 'tumbler'                THEN 'TMB'
      ELSE                              'MCH'
    END;

    -- Find the next free {PREFIX}-NN slot for this tenant. Same idea as the
    -- locations trigger: pull the max numeric suffix on rows whose code
    -- already matches the pattern, then bump.
    SELECT COALESCE(
      MAX(NULLIF(substring(code FROM ('^' || prefix || '-([0-9]+)$')), '')::int),
      0
    ) + 1
    INTO next_n
    FROM public.machines
    WHERE tenant_id = NEW.tenant_id;

    LOOP
      candidate := prefix || '-' || lpad(next_n::text, 2, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.machines
         WHERE tenant_id = NEW.tenant_id AND code = candidate
      );
      next_n := next_n + 1;
      attempts := attempts + 1;
      IF attempts > 200 THEN
        RAISE EXCEPTION 'Could not generate unique machine code after 200 attempts';
      END IF;
    END LOOP;

    NEW.code := candidate;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS machines_autogen_code_trg ON public.machines;
CREATE TRIGGER machines_autogen_code_trg
  BEFORE INSERT ON public.machines
  FOR EACH ROW EXECUTE FUNCTION public.machines_autogen_code();

COMMENT ON FUNCTION public.machines_autogen_code IS
  'Auto-generate machines.code as {3-letter-type-prefix}-NN per tenant when blank on insert. Falls back to MCH-NN for unknown types. Same pattern as migration 048 (locations_autogen_code).';
