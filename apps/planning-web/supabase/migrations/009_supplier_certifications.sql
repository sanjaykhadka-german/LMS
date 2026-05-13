-- ============================================================
-- Phase — Supplier Certifications
-- Adds: supplier_certifications table + Supabase Storage bucket
-- ============================================================

-- ─── TABLE ───────────────────────────────────────────────────────────────────

create table if not exists supplier_certifications (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  supplier_id         uuid not null references suppliers(id) on delete cascade,

  certification_type  text not null,      -- e.g. HACCP, Halal, SQF, BRC, Organic
  certificate_number  text,               -- cert ref / licence number
  issued_by           text,               -- certifying body
  issued_date         date,
  expiry_date         date,               -- NULL = no expiry / ongoing

  -- File stored in Supabase Storage bucket "supplier-certs"
  document_url        text,               -- storage path or external URL
  document_name       text,               -- original filename for display

  status              text not null default 'active'
                        check (status in ('active','expired','pending','suspended')),
  notes               text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table supplier_certifications enable row level security;

drop policy if exists "supplier_certs_select" on supplier_certifications;
drop policy if exists "supplier_certs_insert" on supplier_certifications;
drop policy if exists "supplier_certs_update" on supplier_certifications;
drop policy if exists "supplier_certs_delete" on supplier_certifications;

create policy "supplier_certs_select" on supplier_certifications
  for select using (tenant_id = my_tenant_id());

create policy "supplier_certs_insert" on supplier_certifications
  for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());

create policy "supplier_certs_update" on supplier_certifications
  for update using (tenant_id = my_tenant_id() and is_manager_or_above());

create policy "supplier_certs_delete" on supplier_certifications
  for delete using (tenant_id = my_tenant_id() and is_manager_or_above());

drop trigger if exists trg_supplier_certs_uat on supplier_certifications;
create trigger trg_supplier_certs_uat
  before update on supplier_certifications
  for each row execute procedure update_updated_at();

-- Index for fast expiry lookups (for dashboard alerts)
create index if not exists supplier_certs_expiry_idx
  on supplier_certifications(tenant_id, expiry_date)
  where expiry_date is not null and status = 'active';

-- ─── STORAGE BUCKET ──────────────────────────────────────────────────────────
-- Stores uploaded certification PDFs / images.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'supplier-certs',
  'supplier-certs',
  false,
  10485760,   -- 10 MB limit
  array['application/pdf','image/jpeg','image/png','image/webp']
)
on conflict (id) do nothing;

-- Storage RLS — authenticated users in the tenant can read/write their own certs
drop policy if exists "supplier_certs_storage_select" on storage.objects;
drop policy if exists "supplier_certs_storage_insert" on storage.objects;
drop policy if exists "supplier_certs_storage_delete" on storage.objects;

create policy "supplier_certs_storage_select" on storage.objects
  for select using (bucket_id = 'supplier-certs' and auth.role() = 'authenticated');

create policy "supplier_certs_storage_insert" on storage.objects
  for insert with check (bucket_id = 'supplier-certs' and auth.role() = 'authenticated');

create policy "supplier_certs_storage_delete" on storage.objects
  for delete using (bucket_id = 'supplier-certs' and auth.role() = 'authenticated');
