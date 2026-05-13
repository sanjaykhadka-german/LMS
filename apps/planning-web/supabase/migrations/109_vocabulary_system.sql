-- ============================================================================
-- Migration 109 — Vocabulary system (Phase 1)
--
-- Lets each tenant rename system labels to match how their team talks.
-- Engine continues to use canonical_key (no breaking change to any function);
-- UI calls get_tenant_labels() once on app load and renders display_label.
--
-- All statements idempotent: tables IF NOT EXISTS, functions CREATE OR REPLACE.
-- ============================================================================

-- ── Reference table: canonical keys + system defaults (read-only for users)
CREATE TABLE IF NOT EXISTS public.label_canonical_keys (
  canonical_key     text PRIMARY KEY,
  default_label     text NOT NULL,
  description       text,
  example_locations text,
  sort_order        int  NOT NULL DEFAULT 100,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ── Per-tenant override table
CREATE TABLE IF NOT EXISTS public.tenant_labels (
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id)               ON DELETE CASCADE,
  canonical_key text NOT NULL REFERENCES public.label_canonical_keys(canonical_key) ON DELETE CASCADE,
  display_label text NOT NULL,
  updated_by    uuid REFERENCES public.profiles(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, canonical_key)
);

CREATE INDEX IF NOT EXISTS tenant_labels_tenant_idx ON public.tenant_labels(tenant_id);

-- ── Seed the 8 starter canonical keys (idempotent via ON CONFLICT)
INSERT INTO public.label_canonical_keys (canonical_key, default_label, description, example_locations, sort_order) VALUES
  ('step',         'Stage',                   'A node in the production cascade',                  'Production flow nodes, "Add stage" button, cascade diagrams', 10),
  ('ingredient',   'Ingredient',              'A weight-class component consumed by a recipe',     'Recipe rows, shopping list, raw material schedule',           20),
  ('product',      'Product',                 'An item that gets sold to customers',               'Item types, sales screens, demand plans',                     30),
  ('supply',       'Packaging',               'A non-food item: boxes, labels, films, components', 'Packaging hierarchy, BOM line types',                         40),
  ('department',   'Department',              'Where a stage runs',                                'Stage cards, scheduling kanbans',                             50),
  ('process_loss', 'Process loss',            'Weight lost during a production step',              'Stage edit form, recipe configuration',                       60),
  ('giveaway',     'Average overpack',        'When fill weight exceeds target weight',            'Stage edit form, item master',                                70),
  ('tare',         'Packaging weight (tare)', 'Empty pack/container weight, deducted from gross',  'Item master',                                                 80)
ON CONFLICT (canonical_key) DO NOTHING;

-- ── RLS
ALTER TABLE public.label_canonical_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_labels        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS label_canonical_keys_select ON public.label_canonical_keys;
CREATE POLICY label_canonical_keys_select ON public.label_canonical_keys
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS tenant_labels_select ON public.tenant_labels;
CREATE POLICY tenant_labels_select ON public.tenant_labels
  FOR SELECT USING (tenant_id = my_tenant_id());

DROP POLICY IF EXISTS tenant_labels_insert ON public.tenant_labels;
CREATE POLICY tenant_labels_insert ON public.tenant_labels
  FOR INSERT WITH CHECK (tenant_id = my_tenant_id() AND is_admin_or_above());

DROP POLICY IF EXISTS tenant_labels_update ON public.tenant_labels;
CREATE POLICY tenant_labels_update ON public.tenant_labels
  FOR UPDATE USING (tenant_id = my_tenant_id() AND is_admin_or_above());

DROP POLICY IF EXISTS tenant_labels_delete ON public.tenant_labels;
CREATE POLICY tenant_labels_delete ON public.tenant_labels
  FOR DELETE USING (tenant_id = my_tenant_id() AND is_admin_or_above());

-- ── Read API (called once at app load by the frontend)
CREATE OR REPLACE FUNCTION public.get_tenant_labels()
RETURNS TABLE (
  canonical_key     text,
  display_label     text,
  default_label     text,
  is_overridden     boolean,
  description       text,
  example_locations text,
  sort_order        int
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    k.canonical_key,
    COALESCE(t.display_label, k.default_label) AS display_label,
    k.default_label,
    (t.display_label IS NOT NULL)              AS is_overridden,
    k.description,
    k.example_locations,
    k.sort_order
  FROM public.label_canonical_keys k
  LEFT JOIN public.tenant_labels t
         ON t.tenant_id     = my_tenant_id()
        AND t.canonical_key = k.canonical_key
  ORDER BY k.sort_order, k.canonical_key;
$$;

-- ── Write API (admin-only, validates input)
CREATE OR REPLACE FUNCTION public.set_tenant_label(p_canonical_key text, p_display_label text)
RETURNS public.tenant_labels
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_tenant uuid := my_tenant_id();
  v_row    public.tenant_labels;
BEGIN
  IF NOT is_admin_or_above() THEN
    RAISE EXCEPTION 'only admins can edit tenant vocabulary' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.label_canonical_keys WHERE canonical_key = p_canonical_key) THEN
    RAISE EXCEPTION 'unknown canonical key: %', p_canonical_key USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_display_label IS NULL OR length(trim(p_display_label)) = 0 THEN
    RAISE EXCEPTION 'display label cannot be empty' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO public.tenant_labels (tenant_id, canonical_key, display_label, updated_by, updated_at)
  VALUES (v_tenant, p_canonical_key, trim(p_display_label), auth.uid(), now())
  ON CONFLICT (tenant_id, canonical_key) DO UPDATE
    SET display_label = EXCLUDED.display_label,
        updated_by    = auth.uid(),
        updated_at    = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_tenant_label(p_canonical_key text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin_or_above() THEN
    RAISE EXCEPTION 'only admins can reset tenant vocabulary' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM public.tenant_labels
   WHERE tenant_id     = my_tenant_id()
     AND canonical_key = p_canonical_key;
END;
$$;

GRANT SELECT ON public.label_canonical_keys                           TO authenticated;
GRANT SELECT ON public.tenant_labels                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_labels()                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_label(text, text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_tenant_label(text)             TO authenticated;
