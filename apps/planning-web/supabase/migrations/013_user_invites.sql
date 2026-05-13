-- ============================================================
-- Migration 013 — User Invites
-- Tenant admins invite staff by email; invite is tracked here.
-- After accepting, a trigger assigns the profile to the tenant.
-- ============================================================

create table if not exists user_invites (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  invited_by   uuid references profiles(id),
  email        text not null,
  role         text not null default 'operator'
                 check (role in ('viewer','operator','manager','admin')),
  status       text not null default 'pending'
                 check (status in ('pending','accepted','expired','cancelled')),
  token        text not null unique default encode(gen_random_bytes(32), 'hex'),
  expires_at   timestamptz not null default (now() + interval '7 days'),
  accepted_at  timestamptz,
  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists user_invites_token_idx     on user_invites(token);
create index if not exists user_invites_email_idx     on user_invites(email);
create index if not exists user_invites_tenant_idx    on user_invites(tenant_id);

alter table user_invites enable row level security;

drop policy if exists "user_invites_select" on user_invites;
create policy "user_invites_select" on user_invites
  for select using (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "user_invites_insert" on user_invites;
create policy "user_invites_insert" on user_invites
  for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "user_invites_update" on user_invites;
create policy "user_invites_update" on user_invites
  for update using (tenant_id = my_tenant_id() and is_manager_or_above());

-- ─── PROFILE COLUMNS ─────────────────────────────────────────────────────────
-- Add is_active flag to profiles if not already present

alter table profiles add column if not exists is_active  boolean not null default true;
alter table profiles add column if not exists invited_by uuid references profiles(id);
alter table profiles add column if not exists last_sign_in_at timestamptz;

-- ─── ACCEPT INVITE TRIGGER ───────────────────────────────────────────────────
-- When a new profile row is created (after auth.users insert), check if there's
-- a pending invite for that email and assign the right tenant + role.

create or replace function fn_accept_invite_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite user_invites%rowtype;
  v_email  text;
begin
  -- Get the email from auth.users
  select email into v_email from auth.users where id = NEW.id;

  -- Find the most recent pending non-expired invite for this email
  select * into v_invite
  from user_invites
  where lower(email) = lower(v_email)
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1;

  if found then
    -- Assign tenant + role from invite
    NEW.tenant_id   := v_invite.tenant_id;
    NEW.role        := v_invite.role;
    NEW.invited_by  := v_invite.invited_by;

    -- Mark invite accepted
    update user_invites
    set status = 'accepted', accepted_at = now()
    where id = v_invite.id;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_accept_invite_on_signup on profiles;
create trigger trg_accept_invite_on_signup
  before insert on profiles
  for each row execute procedure fn_accept_invite_on_signup();
