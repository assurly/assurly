-- Live Lock on Vercel Checks.
--
-- The Sign in with Vercel token could not call the REST API, and the
-- preview-then-promote flow gated a different build than the one that shipped.
-- A Vercel integration installation registers a blocking check on each
-- production deployment instead, and Vercel holds the domain until Assurly
-- concludes it.
--
-- No workspace had connected Vercel or locked a project (both tables were
-- empty), so the old columns are dropped, not migrated.

-- ---------------------------------------------------------------------------
-- Connection: one integration installation per workspace.
-- ---------------------------------------------------------------------------

delete from private.vercel_connection;

alter table private.vercel_connection
  add column configuration_id text not null
    check (configuration_id ~ '^icfg_[A-Za-z0-9]{1,64}$');

create unique index if not exists vercel_connection_configuration_id_idx
  on private.vercel_connection (configuration_id);

drop function if exists public.upsert_vercel_connection(uuid, text, text);
drop function if exists public.read_vercel_connection(uuid);
drop function if exists private.upsert_vercel_connection(uuid, text, text);
drop function if exists private.read_vercel_connection(uuid);

create or replace function private.upsert_vercel_connection(
  target_organization_id uuid,
  target_team_id text,
  target_configuration_id text,
  target_token_ciphertext text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.vercel_connection (
    organization_id, team_id, configuration_id, token_ciphertext
  )
  values (
    target_organization_id, target_team_id, target_configuration_id, target_token_ciphertext
  )
  on conflict (organization_id) do update
    set team_id = excluded.team_id,
        configuration_id = excluded.configuration_id,
        token_ciphertext = excluded.token_ciphertext;
end;
$$;

create or replace function private.read_vercel_connection(target_organization_id uuid)
returns table (team_id text, configuration_id text, token_ciphertext text)
language sql
security definer
set search_path = ''
as $$
  select connection.team_id, connection.configuration_id, connection.token_ciphertext
  from private.vercel_connection as connection
  where connection.organization_id = target_organization_id;
$$;

-- Vercel sends integration-configuration.removed when the user uninstalls.
-- The token is dead from then on, so the row and every lock it powered go.
create or replace function private.remove_vercel_connection(target_configuration_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_organization_id uuid;
begin
  delete from private.vercel_connection as connection
  where connection.configuration_id = target_configuration_id
  returning connection.organization_id into removed_organization_id;

  if removed_organization_id is not null then
    delete from public.live_lock_project as project
    where project.organization_id = removed_organization_id;
  end if;

  return removed_organization_id;
end;
$$;

revoke all on function private.upsert_vercel_connection(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function private.read_vercel_connection(uuid) from public, anon, authenticated;
revoke all on function private.remove_vercel_connection(text) from public, anon, authenticated;
grant execute on function private.upsert_vercel_connection(uuid, text, text, text) to service_role;
grant execute on function private.read_vercel_connection(uuid) to service_role;
grant execute on function private.remove_vercel_connection(text) to service_role;

create or replace function public.upsert_vercel_connection(
  target_organization_id uuid,
  target_team_id text,
  target_configuration_id text,
  target_token_ciphertext text
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.upsert_vercel_connection(
    target_organization_id,
    target_team_id,
    target_configuration_id,
    target_token_ciphertext
  );
$$;

create or replace function public.read_vercel_connection(target_organization_id uuid)
returns table (team_id text, configuration_id text, token_ciphertext text)
language sql
security definer
set search_path = ''
as $$
  select connection.team_id, connection.configuration_id, connection.token_ciphertext
  from private.read_vercel_connection(target_organization_id) as connection;
$$;

create or replace function public.remove_vercel_connection(target_configuration_id text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.remove_vercel_connection(target_configuration_id);
$$;

revoke all on function public.upsert_vercel_connection(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.read_vercel_connection(uuid) from public, anon, authenticated;
revoke all on function public.remove_vercel_connection(text) from public, anon, authenticated;
grant execute on function public.upsert_vercel_connection(uuid, text, text, text) to service_role;
grant execute on function public.read_vercel_connection(uuid) to service_role;
grant execute on function public.remove_vercel_connection(text) to service_role;

-- ---------------------------------------------------------------------------
-- Lock: which Vercel project guards which verified URL, and how strictly.
-- ---------------------------------------------------------------------------

delete from public.live_lock_project;

drop index if exists public.live_lock_project_vercel_project_id_idx;

alter table public.live_lock_project
  drop column if exists repository_id,
  drop column if exists production_deploy_held,
  drop column if exists pull_request_url,
  drop column if exists secrets_written,
  add column vercel_team_id text
    check (vercel_team_id is null or vercel_team_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- monitor: the check reports and never blocks. enforce: a blocker fails it.
  add column mode text not null default 'monitor'
    check (mode in ('monitor', 'enforce')),
  alter column vercel_project_id set not null,
  alter column vercel_project_name set not null;

-- One verified URL per Vercel project, so a deployment maps to one target.
create unique index if not exists live_lock_project_vercel_project_idx
  on public.live_lock_project (vercel_project_id);

-- ---------------------------------------------------------------------------
-- Checks: one row per production deployment Assurly registered a check on.
-- Holds rule ids and messages only, never probe samples.
-- ---------------------------------------------------------------------------

create table if not exists public.live_lock_check (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  target_id uuid not null references public.targets (id) on delete cascade,
  vercel_project_id text not null
    check (vercel_project_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  deployment_id text not null
    check (deployment_id ~ '^dpl_[A-Za-z0-9]{1,64}$'),
  deployment_url text not null
    check (deployment_url ~ '^https://[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$'),
  git_sha text
    check (git_sha is null or git_sha ~ '^[0-9a-f]{7,64}$'),
  vercel_check_id text
    check (vercel_check_id is null or vercel_check_id ~ '^[A-Za-z0-9_-]{1,120}$'),
  blocking boolean not null,
  status text not null default 'registered'
    check (status in ('registered', 'running', 'completed')),
  conclusion text
    check (conclusion is null or conclusion in ('succeeded', 'failed', 'neutral')),
  reason text
    check (reason is null or reason in (
      'clear',
      'runtime_blocker',
      'ownership_unverified',
      'deployment_protected',
      'probe_refused',
      'probe_unavailable'
    )),
  ship_score integer check (ship_score is null or ship_score between 0 and 100),
  blockers jsonb not null default '[]'::jsonb
    check (jsonb_typeof(blockers) = 'array'),
  run integer not null default 0 check (run between 0 and 1000),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (deployment_id)
);

alter table public.live_lock_check enable row level security;

create index if not exists live_lock_check_target_created_idx
  on public.live_lock_check (target_id, created_at desc);

create index if not exists live_lock_check_organization_id_idx
  on public.live_lock_check (organization_id);

drop policy if exists select_live_lock_check_member on public.live_lock_check;
create policy select_live_lock_check_member on public.live_lock_check
  for select to authenticated
  using (private.is_organization_member(organization_id));

grant select on table public.live_lock_check to authenticated;
grant select, insert, update, delete on table public.live_lock_check to service_role;
revoke insert, update, delete on table public.live_lock_check from anon, authenticated;
