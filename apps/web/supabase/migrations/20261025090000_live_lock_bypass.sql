-- Live Lock: Vercel Deployment Protection bypass owned by the integration.
--
-- A protected deployment answers its generated URL with a Vercel login, so the
-- check could not see the build. The integration can mint its own bypass
-- secret for the project (scope: Project Protection Bypass). The secret is
-- stored encrypted here, outside the Data API, and only ever sent to that
-- deployment's own origin.

create table if not exists private.live_lock_bypass (
  target_id uuid primary key references public.targets (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vercel_project_id text not null
    check (vercel_project_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  secret_ciphertext text not null
    check (char_length(secret_ciphertext) between 20 and 4000),
  created_at timestamptz not null default timezone('utc', now())
);

alter table private.live_lock_bypass enable row level security;
revoke all privileges on table private.live_lock_bypass from public, anon, authenticated;

create index if not exists live_lock_bypass_organization_id_idx
  on private.live_lock_bypass (organization_id);

create or replace function private.save_live_lock_bypass(
  target_target_id uuid,
  target_organization_id uuid,
  target_vercel_project_id text,
  target_secret_ciphertext text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.live_lock_bypass (
    target_id, organization_id, vercel_project_id, secret_ciphertext
  )
  values (
    target_target_id, target_organization_id, target_vercel_project_id, target_secret_ciphertext
  )
  on conflict (target_id) do update
    set organization_id = excluded.organization_id,
        vercel_project_id = excluded.vercel_project_id,
        secret_ciphertext = excluded.secret_ciphertext,
        created_at = timezone('utc', now());
end;
$$;

create or replace function private.read_live_lock_bypass(target_target_id uuid)
returns table (vercel_project_id text, secret_ciphertext text)
language sql
security definer
set search_path = ''
as $$
  select bypass.vercel_project_id, bypass.secret_ciphertext
  from private.live_lock_bypass as bypass
  where bypass.target_id = target_target_id;
$$;

create or replace function private.delete_live_lock_bypass(target_target_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.live_lock_bypass where target_id = target_target_id;
$$;

-- Uninstall now drops the bypass secrets too: they were minted with the
-- installation that is gone.
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
    delete from private.live_lock_bypass as bypass
    where bypass.organization_id = removed_organization_id;
  end if;

  return removed_organization_id;
end;
$$;

revoke all on function private.save_live_lock_bypass(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function private.read_live_lock_bypass(uuid) from public, anon, authenticated;
revoke all on function private.delete_live_lock_bypass(uuid) from public, anon, authenticated;
grant execute on function private.save_live_lock_bypass(uuid, uuid, text, text) to service_role;
grant execute on function private.read_live_lock_bypass(uuid) to service_role;
grant execute on function private.delete_live_lock_bypass(uuid) to service_role;

create or replace function public.save_live_lock_bypass(
  target_target_id uuid,
  target_organization_id uuid,
  target_vercel_project_id text,
  target_secret_ciphertext text
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.save_live_lock_bypass(
    target_target_id, target_organization_id, target_vercel_project_id, target_secret_ciphertext
  );
$$;

create or replace function public.read_live_lock_bypass(target_target_id uuid)
returns table (vercel_project_id text, secret_ciphertext text)
language sql
security definer
set search_path = ''
as $$
  select bypass.vercel_project_id, bypass.secret_ciphertext
  from private.read_live_lock_bypass(target_target_id) as bypass;
$$;

create or replace function public.delete_live_lock_bypass(target_target_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.delete_live_lock_bypass(target_target_id);
$$;

revoke all on function public.save_live_lock_bypass(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.read_live_lock_bypass(uuid) from public, anon, authenticated;
revoke all on function public.delete_live_lock_bypass(uuid) from public, anon, authenticated;
grant execute on function public.save_live_lock_bypass(uuid, uuid, text, text) to service_role;
grant execute on function public.read_live_lock_bypass(uuid) to service_role;
grant execute on function public.delete_live_lock_bypass(uuid) to service_role;
