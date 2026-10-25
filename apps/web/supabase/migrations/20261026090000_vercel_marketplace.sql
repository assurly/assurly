-- Live Lock as a native Vercel Marketplace integration (Phases 1 and 2 of
-- docs/roadmap/live-lock-native-integration.md).
--
-- A native installation belongs to a Vercel team, not to an Assurly user: the
-- team installs from the Marketplace without an Assurly account. Each
-- installation therefore gets its own Assurly organization. A resource is one
-- guarded Vercel project; connecting it to a project creates the url target
-- (ownership attested by Vercel) and the Live Lock link.

-- ---------------------------------------------------------------------------
-- Installation: the non-expiring access token lives here, encrypted, outside
-- the Data API.
-- ---------------------------------------------------------------------------

create table if not exists private.vercel_installation (
  installation_id text primary key
    check (installation_id ~ '^icfg_[A-Za-z0-9]{1,64}$'),
  organization_id uuid not null unique
    references public.organizations (id) on delete cascade,
  account_id text not null check (char_length(account_id) between 1 and 128),
  token_ciphertext text not null check (char_length(token_ciphertext) between 20 and 4000),
  billing_plan_id text not null default 'free' check (billing_plan_id in ('free', 'pro')),
  account_name text check (account_name is null or char_length(account_name) between 1 and 200),
  contact_email text check (contact_email is null or char_length(contact_email) between 3 and 320),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table private.vercel_installation enable row level security;
revoke all privileges on table private.vercel_installation from public, anon, authenticated;

-- Creates the installation and its organization on first sight, refreshes the
-- token and account details on a repeat (Vercel retries and re-sends PUT).
create or replace function private.upsert_vercel_installation(
  target_installation_id text,
  target_account_id text,
  target_token_ciphertext text,
  target_account_name text,
  target_contact_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_organization_id uuid;
  created_organization_id uuid;
begin
  select installation.organization_id into existing_organization_id
  from private.vercel_installation as installation
  where installation.installation_id = target_installation_id
  for update;

  if existing_organization_id is not null then
    update private.vercel_installation
      set token_ciphertext = target_token_ciphertext,
          account_name = coalesce(target_account_name, account_name),
          contact_email = coalesce(target_contact_email, contact_email),
          updated_at = timezone('utc', now())
      where installation_id = target_installation_id;
    return existing_organization_id;
  end if;

  insert into public.organizations (name)
  values (coalesce(nullif(btrim(target_account_name), ''), 'Vercel team'))
  returning id into created_organization_id;

  insert into private.vercel_installation (
    installation_id, organization_id, account_id, token_ciphertext, account_name, contact_email
  )
  values (
    target_installation_id, created_organization_id, target_account_id,
    target_token_ciphertext, target_account_name, target_contact_email
  );

  return created_organization_id;
end;
$$;

create or replace function private.read_vercel_installation(target_installation_id text)
returns table (
  organization_id uuid,
  account_id text,
  token_ciphertext text,
  billing_plan_id text
)
language sql
security definer
set search_path = ''
as $$
  select installation.organization_id, installation.account_id,
         installation.token_ciphertext, installation.billing_plan_id
  from private.vercel_installation as installation
  where installation.installation_id = target_installation_id;
$$;

create or replace function private.set_vercel_installation_plan(
  target_installation_id text,
  target_billing_plan_id text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update private.vercel_installation
    set billing_plan_id = target_billing_plan_id,
        updated_at = timezone('utc', now())
    where installation_id = target_installation_id
  returning true;
$$;

-- Uninstall drops the token and every lock the installation powered. The
-- organization and its history stay: a reinstall is a new installation and
-- gets a new organization, as Vercel asks partners to treat it.
create or replace function private.delete_vercel_installation(target_installation_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_organization_id uuid;
begin
  -- Bypass secrets minted with this installation's token die with it.
  delete from private.live_lock_bypass as bypass
  using public.live_lock_resource as resource
  where bypass.target_id = resource.target_id
    and resource.installation_id = target_installation_id;

  delete from public.live_lock_project as project
  using public.live_lock_resource as resource
  where project.resource_id = resource.resource_id
    and resource.installation_id = target_installation_id;

  delete from public.live_lock_resource as resource
  where resource.installation_id = target_installation_id;

  delete from private.vercel_installation as installation
  where installation.installation_id = target_installation_id
  returning installation.organization_id into removed_organization_id;

  return removed_organization_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Resource: one Live Lock the team created in Vercel. Connected to at most one
-- project; the project's production domain becomes the guarded url target.
-- ---------------------------------------------------------------------------

create table if not exists public.live_lock_resource (
  resource_id uuid primary key default gen_random_uuid(),
  installation_id text not null
    check (installation_id ~ '^icfg_[A-Za-z0-9]{1,64}$'),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  mode text not null default 'monitor' check (mode in ('monitor', 'enforce')),
  status text not null default 'ready' check (status in ('ready', 'suspended')),
  vercel_project_id text unique
    check (vercel_project_id is null or vercel_project_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  target_id uuid references public.targets (id) on delete set null,
  -- The v2 project check Vercel runs on each production deployment.
  vercel_check_id text
    check (vercel_check_id is null or vercel_check_id ~ '^[A-Za-z0-9_-]{1,120}$'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.live_lock_resource enable row level security;

create index if not exists live_lock_resource_installation_idx
  on public.live_lock_resource (installation_id);
create index if not exists live_lock_resource_organization_idx
  on public.live_lock_resource (organization_id);
create index if not exists live_lock_resource_target_idx
  on public.live_lock_resource (target_id);

drop policy if exists select_live_lock_resource_member on public.live_lock_resource;
create policy select_live_lock_resource_member on public.live_lock_resource
  for select to authenticated
  using (private.is_organization_member(organization_id));

grant select on table public.live_lock_resource to authenticated;
grant select, insert, update, delete on table public.live_lock_resource to service_role;
revoke insert, update, delete on table public.live_lock_resource from anon, authenticated;

-- A native lock points at its resource. The v1 webhook path skips these rows:
-- Vercel runs their checks through the project check instead.
alter table public.live_lock_project
  add column if not exists resource_id uuid
    references public.live_lock_resource (resource_id) on delete cascade;

create unique index if not exists live_lock_project_resource_idx
  on public.live_lock_project (resource_id)
  where resource_id is not null;

-- v1 checks are registered per deployment; v2 check runs are started by Vercel.
alter table public.live_lock_check
  add column if not exists source text not null default 'deployment_check'
    check (source in ('deployment_check', 'check_run'));

-- A production domain of a project the installing team owns, attested by a
-- signed Vercel event rather than a DNS or file challenge.
alter table public.targets drop constraint if exists targets_ownership_method_check;
alter table public.targets add constraint targets_ownership_method_check
  check (ownership_method in (
    'github_app', 'dns_txt', 'meta_tag', 'file', 'deploy_link', 'vercel_project'
  ));

-- ---------------------------------------------------------------------------
-- Grants: service_role only, through public wrappers like the other Live Lock
-- RPCs.
-- ---------------------------------------------------------------------------

revoke all on function private.upsert_vercel_installation(text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function private.read_vercel_installation(text) from public, anon, authenticated;
revoke all on function private.set_vercel_installation_plan(text, text)
  from public, anon, authenticated;
revoke all on function private.delete_vercel_installation(text) from public, anon, authenticated;
grant execute on function private.upsert_vercel_installation(text, text, text, text, text)
  to service_role;
grant execute on function private.read_vercel_installation(text) to service_role;
grant execute on function private.set_vercel_installation_plan(text, text) to service_role;
grant execute on function private.delete_vercel_installation(text) to service_role;

create or replace function public.upsert_vercel_installation(
  target_installation_id text,
  target_account_id text,
  target_token_ciphertext text,
  target_account_name text,
  target_contact_email text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.upsert_vercel_installation(
    target_installation_id, target_account_id, target_token_ciphertext,
    target_account_name, target_contact_email
  );
$$;

create or replace function public.read_vercel_installation(target_installation_id text)
returns table (
  organization_id uuid,
  account_id text,
  token_ciphertext text,
  billing_plan_id text
)
language sql
security definer
set search_path = ''
as $$
  select installation.organization_id, installation.account_id,
         installation.token_ciphertext, installation.billing_plan_id
  from private.read_vercel_installation(target_installation_id) as installation;
$$;

create or replace function public.set_vercel_installation_plan(
  target_installation_id text,
  target_billing_plan_id text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.set_vercel_installation_plan(target_installation_id, target_billing_plan_id);
$$;

create or replace function public.delete_vercel_installation(target_installation_id text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.delete_vercel_installation(target_installation_id);
$$;

revoke all on function public.upsert_vercel_installation(text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.read_vercel_installation(text) from public, anon, authenticated;
revoke all on function public.set_vercel_installation_plan(text, text)
  from public, anon, authenticated;
revoke all on function public.delete_vercel_installation(text) from public, anon, authenticated;
grant execute on function public.upsert_vercel_installation(text, text, text, text, text)
  to service_role;
grant execute on function public.read_vercel_installation(text) to service_role;
grant execute on function public.set_vercel_installation_plan(text, text) to service_role;
grant execute on function public.delete_vercel_installation(text) to service_role;
