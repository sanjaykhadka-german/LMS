-- Migration 029: Purchase Orders

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  po_number     text,
  supplier_id   uuid REFERENCES public.suppliers(id),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'received', 'cancelled')),
  order_date    date NOT NULL DEFAULT CURRENT_DATE,
  expected_date date,
  notes         text,
  created_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  item_id         uuid NOT NULL REFERENCES public.items(id),
  supplier_item_id uuid REFERENCES public.supplier_items(id),
  qty_ordered     numeric NOT NULL DEFAULT 0,
  unit            text,
  unit_price      numeric,
  currency        text DEFAULT 'AUD',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public.purchase_order_seq START 1;

ALTER TABLE public.purchase_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY purchase_orders_tenant ON public.purchase_orders
  USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY purchase_order_lines_tenant ON public.purchase_order_lines
  USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS po_tenant_idx       ON public.purchase_orders(tenant_id);
CREATE INDEX IF NOT EXISTS po_supplier_idx     ON public.purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS po_lines_po_idx     ON public.purchase_order_lines(purchase_order_id);
CREATE INDEX IF NOT EXISTS po_lines_item_idx   ON public.purchase_order_lines(item_id);
