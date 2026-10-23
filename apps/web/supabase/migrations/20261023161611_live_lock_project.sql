-- Live Lock setup for one guarded URL. The Vercel token lives in private and
-- is never selectable through the Data API. This table stores only the link.

create table if not exists public.live_lock_project (
  target_id uuid primary key references public.targets (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  repository_id uuid references public.repositories (id) on delete set null,
  vercel_project_id text
    check (vercel_project_id is null or vercel_project_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  vercel_project_name text
    check (vercel_project_name is null or char_length(vercel_project_name) between 1 and 100),
  production_deploy_held boolean not null default false,
  pull_request_url text
    check (pull_request_url is null or pull_request_url ~ '^https://github.com/'),
  secrets_written boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.live_lock_project enable row level security;

create index if not exists live_lock_project_organization_id_idx
  on public.live_lock_project (organization_id);

create index if not exists live_lock_project_vercel_project_id_idx
  on public.live_lock_project (vercel_project_id)
  where production_deploy_held;

drop policy if exists select_live_lock_project_member on public.live_lock_project;
create policy select_live_lock_project_member on public.live_lock_project
  for select to authenticated
  using (private.is_organization_member(organization_id));

grant select on table public.live_lock_project to authenticated;
grant select, insert, update, delete on table public.live_lock_project to service_role;
revoke insert, update, delete on table public.live_lock_project from anon, authenticated;

create table if not exists private.vercel_connection (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  team_id text
    check (team_id is null or team_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  token_ciphertext text not null
    check (char_length(token_ciphertext) between 20 and 4000),
  created_at timestamptz not null default timezone('utc', now())
);

alter table private.vercel_connection enable row level security;

revoke all privileges on table private.vercel_connection from public, anon, authenticated;

-- Security definer stays out of the exposed public schema. service_role calls
-- these through PostgREST only after execute is granted to that role alone.
create or replace function private.upsert_vercel_connection(
  target_organization_id uuid,
  target_team_id text,
  target_token_ciphertext text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.vercel_connection (organization_id, team_id, token_ciphertext)
  values (target_organization_id, target_team_id, target_token_ciphertext)
  on conflict (organization_id) do update
    set team_id = excluded.team_id,
        token_ciphertext = excluded.token_ciphertext;
end;
$$;

create or replace function private.read_vercel_connection(target_organization_id uuid)
returns table (team_id text, token_ciphertext text)
language sql
security definer
set search_path = ''
as $$
  select connection.team_id, connection.token_ciphertext
  from private.vercel_connection as connection
  where connection.organization_id = target_organization_id;
$$;

revoke all on function private.upsert_vercel_connection(uuid, text, text) from public, anon, authenticated;
revoke all on function private.read_vercel_connection(uuid) from public, anon, authenticated;
grant execute on function private.upsert_vercel_connection(uuid, text, text) to service_role;
grant execute on function private.read_vercel_connection(uuid) to service_role;

-- PostgREST only exposes public. These wrappers do not return to anon or
-- authenticated; service_role is the admin adapter.
create or replace function public.upsert_vercel_connection(
  target_organization_id uuid,
  target_team_id text,
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
    target_token_ciphertext
  );
$$;

create or replace function public.read_vercel_connection(target_organization_id uuid)
returns table (team_id text, token_ciphertext text)
language sql
security definer
set search_path = ''
as $$
  select connection.team_id, connection.token_ciphertext
  from private.read_vercel_connection(target_organization_id) as connection;
$$;

revoke all on function public.upsert_vercel_connection(uuid, text, text) from public, anon, authenticated;
revoke all on function public.read_vercel_connection(uuid) from public, anon, authenticated;
grant execute on function public.upsert_vercel_connection(uuid, text, text) to service_role;
grant execute on function public.read_vercel_connection(uuid) to service_role;
