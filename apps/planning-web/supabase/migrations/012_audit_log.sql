-- ============================================================
-- Migration 012 — Full Audit Log
-- Records every INSERT / UPDATE / DELETE on key tables,
-- capturing who did it, when, and before/after values.
-- Only accessible to admin role.
-- ============================================================

-- ─── AUDIT LOG TABLE ─────────────────────────────────────────────────────────

create table if not exists audit_log (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid,                      -- populated from auth context
  user_id          uuid,                      -- auth.uid() at time of change
  user_email       text,                      -- denormalised for readability
  action           text not null              -- INSERT | UPDATE | DELETE
                     check (action in ('INSERT','UPDATE','DELETE')),
  table_name       text not null,             -- which table was changed
  record_id        uuid,                      -- pk of the changed row
  record_label     text,                      -- human-readable e.g. "Ace Meats (SUP001)"
  old_values       jsonb,                     -- full row before (NULL for INSERT)
  new_values       jsonb,                     -- full row after  (NULL for DELETE)
  changed_fields   text[],                    -- list of field names that differed (UPDATE only)
  ip_address       inet,                      -- captured if available
  created_at       timestamptz not null default now()
);

-- Partition-friendly index: most queries filter by tenant + date
create index if not exists audit_log_tenant_date_idx on audit_log(tenant_id, created_at desc);
create index if not exists audit_log_table_record_idx on audit_log(table_name, record_id);
create index if not exists audit_log_user_idx on audit_log(user_id);

alter table audit_log enable row level security;

-- Only admins can read the audit log
drop policy if exists "audit_log_select" on audit_log;
create policy "audit_log_select" on audit_log
  for select using (tenant_id = my_tenant_id() and (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  ));

-- Inserts come from the trigger (runs as table owner), not from app code directly
-- We allow insert from authenticated role so the trigger function (SECURITY DEFINER) can write
drop policy if exists "audit_log_insert" on audit_log;
create policy "audit_log_insert" on audit_log
  for insert with check (true);

-- ─── TRIGGER FUNCTION ────────────────────────────────────────────────────────

create or replace function fn_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action      text;
  v_old         jsonb := null;
  v_new         jsonb := null;
  v_changed     text[] := null;
  v_record_id   uuid;
  v_tenant_id   uuid;
  v_label       text := null;
begin
  v_action := TG_OP;  -- INSERT | UPDATE | DELETE

  -- Capture row data
  if TG_OP = 'DELETE' then
    v_old       := row_to_json(OLD)::jsonb;
    v_record_id := (OLD).id;
    v_tenant_id := (OLD).tenant_id;
  elsif TG_OP = 'INSERT' then
    v_new       := row_to_json(NEW)::jsonb;
    v_record_id := (NEW).id;
    v_tenant_id := (NEW).tenant_id;
  else  -- UPDATE
    v_old       := row_to_json(OLD)::jsonb;
    v_new       := row_to_json(NEW)::jsonb;
    v_record_id := (NEW).id;
    v_tenant_id := (NEW).tenant_id;
    -- Compute which fields actually changed
    select array_agg(key) into v_changed
    from (
      select key
      from jsonb_each(v_new) n
      where n.value is distinct from (v_old -> n.key)
        and n.key not in ('updated_at', 'created_at')
    ) diff;
  end if;

  -- Build human-readable record label based on table
  v_label := case TG_TABLE_NAME
    when 'suppliers'          then coalesce(
      (coalesce(v_new, v_old) ->> 'name') || ' (' || (coalesce(v_new, v_old) ->> 'code') || ')', null)
    when 'customers'          then coalesce(
      (coalesce(v_new, v_old) ->> 'name') || ' (' || (coalesce(v_new, v_old) ->> 'code') || ')', null)
    when 'items'              then coalesce(
      (coalesce(v_new, v_old) ->> 'name') || ' (' || (coalesce(v_new, v_old) ->> 'code') || ')', null)
    when 'bom_headers'        then 'BOM v' || (coalesce(v_new, v_old) ->> 'version')
    when 'production_orders'  then 'Order ' || (coalesce(v_new, v_old) ->> 'batch_number')
    when 'departments'        then coalesce(v_new, v_old) ->> 'name'
    when 'machines'           then coalesce(v_new, v_old) ->> 'name'
    when 'machine_breakdowns' then 'Breakdown on machine'
    else null
  end;

  insert into audit_log (
    tenant_id, user_id, user_email,
    action, table_name, record_id, record_label,
    old_values, new_values, changed_fields
  )
  values (
    v_tenant_id,
    auth.uid(),
    (select email from auth.users where id = auth.uid()),
    v_action,
    TG_TABLE_NAME,
    v_record_id,
    v_label,
    v_old,
    v_new,
    v_changed
  );

  return coalesce(NEW, OLD);
end;
$$;

-- ─── ATTACH TRIGGERS ─────────────────────────────────────────────────────────

-- Suppliers
drop trigger if exists trg_audit_suppliers on suppliers;
create trigger trg_audit_suppliers
  after insert or update or delete on suppliers
  for each row execute procedure fn_audit_log();

-- Customers
drop trigger if exists trg_audit_customers on customers;
create trigger trg_audit_customers
  after insert or update or delete on customers
  for each row execute procedure fn_audit_log();

-- Items
drop trigger if exists trg_audit_items on items;
create trigger trg_audit_items
  after insert or update or delete on items
  for each row execute procedure fn_audit_log();

-- BOM headers
drop trigger if exists trg_audit_bom_headers on bom_headers;
create trigger trg_audit_bom_headers
  after insert or update or delete on bom_headers
  for each row execute procedure fn_audit_log();

-- Production orders
drop trigger if exists trg_audit_production_orders on production_orders;
create trigger trg_audit_production_orders
  after insert or update or delete on production_orders
  for each row execute procedure fn_audit_log();

-- Departments
drop trigger if exists trg_audit_departments on departments;
create trigger trg_audit_departments
  after insert or update or delete on departments
  for each row execute procedure fn_audit_log();

-- Machines
drop trigger if exists trg_audit_machines on machines;
create trigger trg_audit_machines
  after insert or update or delete on machines
  for each row execute procedure fn_audit_log();

-- Machine breakdowns
drop trigger if exists trg_audit_machine_breakdowns on machine_breakdowns;
create trigger trg_audit_machine_breakdowns
  after insert or update or delete on machine_breakdowns
  for each row execute procedure fn_audit_log();
