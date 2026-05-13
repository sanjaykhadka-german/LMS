-- ============================================================================
-- 073  TENANT_PACK_LEVEL_DEFS — per-tenant catalogue of pack hierarchy levels
-- ----------------------------------------------------------------------------
-- Phase 1 of "Option B" — flexible pack hierarchy via JSONB.
--
-- Today the schema hard-codes piece → inner → outer → pallet via three
-- columns (units_per_inner, inner_per_outer, outers_per_pallet). Tenants who
-- need a deeper chain (e.g. 3 sausages × 5 inners × 2 sub-outers × 100 outers
-- per pallet) can't express it. This migration introduces a tenant-level
-- catalogue of named levels — the actual depth and ordering is per-tenant.
--
-- The next migration (074) adds items.pack_levels jsonb, an ordered array of
-- { code, qty_per_below } that references codes in this catalogue. A sync
-- trigger keeps the legacy units_per_inner / inner_per_outer / outers_per_pallet
-- columns up-to-date so existing code paths (BOM editor, explode_mrp,
-- per_inner / per_outer / per_pallet basis, etc.) keep working unchanged.
--
-- Seed: every existing tenant gets the four-level default catalogue
-- (inner / sub_outer / outer / pallet). They can rename, deactivate, or
-- add levels via the /settings/pack-levels page.
-- ============================================================================

create table public.tenant_pack_level_defs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  code        text not null,                 -- e.g. 'inner', 'sub_outer', 'outer', 'pallet'
  name        text not null,                 -- display label (operator-facing)
  short_label text,                          -- compact 1-2 char tag for tight UI (e.g. 'I')
  sort_order  int  not null default 100,     -- ascending = bottom-up (closest to piece first)
  is_active   boolean not null default true,
  is_default  boolean not null default false,-- one true per tenant — the level shipped to new items by default
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, code)
);

create index idx_tplds_tenant_active on public.tenant_pack_level_defs (tenant_id, is_active, sort_order);

alter table public.tenant_pack_level_defs enable row level security;

create policy "tplds_select" on public.tenant_pack_level_defs
  for select using (tenant_id = my_tenant_id());
create policy "tplds_insert" on public.tenant_pack_level_defs
  for insert with check (tenant_id = my_tenant_id() and is_admin_or_above());
create policy "tplds_update" on public.tenant_pack_level_defs
  for update using (tenant_id = my_tenant_id() and is_admin_or_above());
create policy "tplds_delete" on public.tenant_pack_level_defs
  for delete using (tenant_id = my_tenant_id() and is_admin_or_above());

create trigger trg_tplds_uat
  before update on public.tenant_pack_level_defs
  for each row execute procedure update_updated_at();

-- Seed default 4-level hierarchy for every existing tenant.
insert into public.tenant_pack_level_defs (tenant_id, code, name, short_label, sort_order, is_default)
select t.id, x.code, x.name, x.short_label, x.sort_order, x.is_default
from public.tenants t
cross join (values
  ('inner',     'Inner',     'I', 1, true ),
  ('sub_outer', 'Sub-outer', 'M', 2, false),
  ('outer',     'Outer',     'O', 3, false),
  ('pallet',    'Pallet',    'P', 4, false)
) as x(code, name, short_label, sort_order, is_default)
on conflict (tenant_id, code) do nothing;
