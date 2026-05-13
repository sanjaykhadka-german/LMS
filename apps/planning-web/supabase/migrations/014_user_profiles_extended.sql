-- ============================================================
-- Migration 014 — Extended User Profiles
-- Adds contact details, HR fields, department access, and
-- a flexible per-tenant user category register.
-- ============================================================

-- ─── USER CATEGORIES ─────────────────────────────────────────────────────────
-- Flexible per-tenant categories: Employee, Contractor, Supplier, Customer, etc.

create table if not exists user_categories (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  name        text not null,
  description text,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique(tenant_id, name)
);

create index if not exists user_categories_tenant_idx on user_categories(tenant_id);

alter table user_categories enable row level security;

drop policy if exists "user_categories_select" on user_categories;
create policy "user_categories_select" on user_categories
  for select using (tenant_id = my_tenant_id());

drop policy if exists "user_categories_insert" on user_categories;
create policy "user_categories_insert" on user_categories
  for insert with check (tenant_id = my_tenant_id() and is_admin_or_above());

drop policy if exists "user_categories_update" on user_categories;
create policy "user_categories_update" on user_categories
  for update using (tenant_id = my_tenant_id() and is_admin_or_above());

drop policy if exists "user_categories_delete" on user_categories;
create policy "user_categories_delete" on user_categories
  for delete using (tenant_id = my_tenant_id() and is_admin_or_above());

-- Seed default categories for German Butchery tenant
insert into user_categories (tenant_id, name, description, sort_order)
select t.id, c.name, c.description, c.sort_order
from tenants t,
  (values
    ('Employee',   'Full-time or part-time staff on payroll',        1),
    ('Contractor', 'External contractor or casual worker',           2),
    ('Supplier',   'Supplier representative or contact',             3),
    ('Customer',   'Customer contact with system access',            4)
  ) as c(name, description, sort_order)
where t.subdomain = 'germanbutchery'
on conflict (tenant_id, name) do nothing;

-- Helper function to seed default categories for any new tenant
create or replace function seed_user_categories(p_tenant_id uuid)
returns void language plpgsql security definer as $$
begin
  insert into user_categories (tenant_id, name, description, sort_order)
  values
    (p_tenant_id, 'Employee',   'Full-time or part-time staff on payroll',  1),
    (p_tenant_id, 'Contractor', 'External contractor or casual worker',      2),
    (p_tenant_id, 'Supplier',   'Supplier representative or contact',        3),
    (p_tenant_id, 'Customer',   'Customer contact with system access',       4)
  on conflict (tenant_id, name) do nothing;
end;
$$;

-- ─── PROFILE COLUMNS ─────────────────────────────────────────────────────────

-- Contact details
alter table profiles add column if not exists phone        text;
alter table profiles add column if not exists address_line1 text;
alter table profiles add column if not exists address_line2 text;
alter table profiles add column if not exists city         text;
alter table profiles add column if not exists state        text;
alter table profiles add column if not exists postcode     text;
alter table profiles add column if not exists country      text default 'AU';
alter table profiles add column if not exists date_of_birth date;

-- HR / employment
alter table profiles add column if not exists category_id      uuid references user_categories(id);
alter table profiles add column if not exists work_department_id uuid references departments(id);
alter table profiles add column if not exists all_departments  boolean not null default true;
alter table profiles add column if not exists start_date       date;
alter table profiles add column if not exists finished_date    date;
-- invite_date: already captured as created_at on user_invites; expose via view below

-- ─── DEPARTMENT ACCESS ───────────────────────────────────────────────────────
-- When all_departments = false, explicit rows here control which departments
-- the user can see data for. When all_departments = true this table is ignored.

create table if not exists user_department_access (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  profile_id    uuid not null references profiles(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique(profile_id, department_id)
);

create index if not exists uda_profile_idx    on user_department_access(profile_id);
create index if not exists uda_dept_idx       on user_department_access(department_id);
create index if not exists uda_tenant_idx     on user_department_access(tenant_id);

alter table user_department_access enable row level security;

drop policy if exists "uda_select" on user_department_access;
create policy "uda_select" on user_department_access
  for select using (tenant_id = my_tenant_id());

drop policy if exists "uda_insert" on user_department_access;
create policy "uda_insert" on user_department_access
  for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "uda_delete" on user_department_access;
create policy "uda_delete" on user_department_access
  for delete using (tenant_id = my_tenant_id() and is_manager_or_above());

-- ─── AUDIT TRIGGER ON user_categories ────────────────────────────────────────
drop trigger if exists trg_user_categories_audit on user_categories;
create trigger trg_user_categories_audit
  after insert or update or delete on user_categories
  for each row execute procedure fn_audit_log();

