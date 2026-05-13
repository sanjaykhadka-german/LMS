-- Migration 038: Product Specification Sheets
-- Tables: product_specs, item_pallet_config, pallet_config_templates, spec_images, spec_sends

-- ─────────────────────────────────────────────
-- 1. pallet_config_templates  (settings-level reusable templates)
-- ─────────────────────────────────────────────
CREATE TABLE public.pallet_config_templates (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name              text NOT NULL,
  description       text,
  ti                integer,          -- units per layer
  hi                integer,          -- layers per pallet
  pallet_type       text NOT NULL DEFAULT 'plain' CHECK (pallet_type IN ('chep','loscam','plain','other')),
  pallet_length_mm  integer,
  pallet_width_mm   integer,
  pallet_height_mm  integer,
  max_weight_kg     numeric(10,3),
  is_active         boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE public.pallet_config_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY pct_tenant ON public.pallet_config_templates FOR ALL USING (tenant_id = public.my_tenant_id());
CREATE INDEX idx_pct_tenant ON public.pallet_config_templates(tenant_id);

-- ─────────────────────────────────────────────
-- 2. item_pallet_config  (per-item pallet config)
-- ─────────────────────────────────────────────
CREATE TABLE public.item_pallet_config (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id             uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  template_id         uuid REFERENCES public.pallet_config_templates(id) ON DELETE SET NULL,
  ti                  integer,
  hi                  integer,
  units_per_pallet    integer GENERATED ALWAYS AS (ti * hi) STORED,
  carton_length_mm    integer,
  carton_width_mm     integer,
  carton_height_mm    integer,
  carton_gross_weight_kg numeric(10,3),
  carton_net_weight_kg   numeric(10,3),
  pallet_type         text NOT NULL DEFAULT 'plain' CHECK (pallet_type IN ('chep','loscam','plain','other')),
  pallet_length_mm    integer,
  pallet_width_mm     integer,
  stack_height_mm     integer,
  total_pallet_weight_kg numeric(10,3),
  notes               text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  UNIQUE (tenant_id, item_id)
);
ALTER TABLE public.item_pallet_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY ipc_tenant ON public.item_pallet_config FOR ALL USING (tenant_id = public.my_tenant_id());
CREATE INDEX idx_ipc_item ON public.item_pallet_config(item_id);

-- ─────────────────────────────────────────────
-- 3. product_specs  (versioned spec sheets)
-- ─────────────────────────────────────────────
CREATE TABLE public.product_specs (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id         uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  version         integer NOT NULL DEFAULT 1,
  version_label   text NOT NULL DEFAULT '1.0',
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  approved_at     timestamptz,
  approved_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  internal_notes  text,

  -- Override fields (NULL = use item master value)
  spec_storage_temp   text,
  spec_shelf_life     text,
  spec_notes          text,
  spec_origin         text,
  spec_fat_content    text,
  spec_protein        text,
  spec_moisture       text,
  spec_ph             text,
  spec_water_activity text,
  spec_micro          text,
  spec_packaging      text,
  spec_labelling      text,

  -- Nutrition overrides
  nut_energy_kj       numeric(10,2),
  nut_energy_kcal     numeric(10,2),
  nut_protein_g       numeric(10,2),
  nut_fat_total_g     numeric(10,2),
  nut_fat_saturated_g numeric(10,2),
  nut_fat_trans_g     numeric(10,2),
  nut_carbs_total_g   numeric(10,2),
  nut_carbs_sugars_g  numeric(10,2),
  nut_fibre_g         numeric(10,2),
  nut_sodium_mg       numeric(10,2),
  nut_per_serving_g   numeric(10,2),
  nut_notes           text,

  allergens           text[],

  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),

  UNIQUE (tenant_id, item_id, version)
);
ALTER TABLE public.product_specs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ps_tenant ON public.product_specs FOR ALL USING (tenant_id = public.my_tenant_id());
CREATE INDEX idx_ps_item ON public.product_specs(item_id);
CREATE INDEX idx_ps_tenant_status ON public.product_specs(tenant_id, status);

-- ─────────────────────────────────────────────
-- 4. spec_images  (hero shot, packed product, other)
-- ─────────────────────────────────────────────
CREATE TABLE public.spec_images (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  spec_id       uuid REFERENCES public.product_specs(id) ON DELETE SET NULL,
  image_type    text NOT NULL DEFAULT 'other' CHECK (image_type IN ('hero','packed','other')),
  storage_path  text NOT NULL,
  public_url    text,
  caption       text,
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE public.spec_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY si_tenant ON public.spec_images FOR ALL USING (tenant_id = public.my_tenant_id());
CREATE INDEX idx_si_item ON public.spec_images(item_id);
CREATE INDEX idx_si_spec ON public.spec_images(spec_id);

-- ─────────────────────────────────────────────
-- 5. spec_sends  (customer send archive)
-- ─────────────────────────────────────────────
CREATE TABLE public.spec_sends (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  spec_id          uuid NOT NULL REFERENCES public.product_specs(id) ON DELETE CASCADE,
  item_id          uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  customer_id      uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  document_type    text NOT NULL DEFAULT 'spec' CHECK (document_type IN ('spec','pif')),
  sent_at          timestamptz NOT NULL DEFAULT now(),
  sent_by          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_name   text,
  recipient_email  text,
  version_label    text,
  snapshot         jsonb NOT NULL DEFAULT '{}',  -- full spec snapshot at send time
  notes            text,
  created_at       timestamptz DEFAULT now()
);
ALTER TABLE public.spec_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY ss_tenant ON public.spec_sends FOR ALL USING (tenant_id = public.my_tenant_id());
CREATE INDEX idx_ss_spec ON public.spec_sends(spec_id);
CREATE INDEX idx_ss_item ON public.spec_sends(item_id);
CREATE INDEX idx_ss_tenant ON public.spec_sends(tenant_id);
