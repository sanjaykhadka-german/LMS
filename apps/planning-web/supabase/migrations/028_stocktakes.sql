-- Migration 028: Stocktakes (physical stock counts)

CREATE TABLE IF NOT EXISTS public.stocktakes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reference     text,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  notes         text,
  counted_by    uuid REFERENCES public.profiles(id),
  submitted_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stocktake_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stocktake_id   uuid NOT NULL REFERENCES public.stocktakes(id) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES public.items(id),
  system_qty     numeric NOT NULL DEFAULT 0,
  counted_qty    numeric,
  variance       numeric GENERATED ALWAYS AS (COALESCE(counted_qty, 0) - system_qty) STORED,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public.stocktake_seq START 1;

ALTER TABLE public.stocktakes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stocktake_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY stocktakes_tenant ON public.stocktakes
  USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY stocktake_lines_tenant ON public.stocktake_lines
  USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS stocktakes_tenant_idx      ON public.stocktakes(tenant_id);
CREATE INDEX IF NOT EXISTS stocktake_lines_st_idx     ON public.stocktake_lines(stocktake_id);
CREATE INDEX IF NOT EXISTS stocktake_lines_item_idx   ON public.stocktake_lines(item_id);
