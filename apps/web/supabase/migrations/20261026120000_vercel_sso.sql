-- Vercel Marketplace SSO (Phase 3 of docs/roadmap/live-lock-native-integration.md).
--
-- "Open in Assurly" in Vercel signs a team member into the organization that
-- belongs to the team's installation. Until now a user had exactly one
-- membership, so "the user's organization" was unambiguous. A person who also
-- has a personal workspace now has two, so the active one is the membership
-- selected last, and the dashboard can switch between them.

alter table public.memberships
  add column if not exists last_selected_at timestamptz;

create index if not exists memberships_user_selected_idx
  on public.memberships (user_id, last_selected_at desc nulls last, created_at);

-- The signed-in user picks one of their own workspaces. Membership is checked
-- here, so another organization's id simply matches no row.
create or replace function private.select_organization(target_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id text := (select auth.uid())::text;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  update public.memberships
    set last_selected_at = timezone('utc', now())
    where user_id = current_user_id
      and organization_id = target_organization_id;

  return found;
end;
$$;

create or replace function public.select_organization(target_organization_id uuid)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.select_organization(target_organization_id);
$$;

revoke all on function private.select_organization(uuid) from public, anon;
grant execute on function private.select_organization(uuid) to authenticated;
revoke all on function public.select_organization(uuid) from public, anon;
grant execute on function public.select_organization(uuid) to authenticated;

-- Service role only: called after Vercel's SSO token is verified. Adds the
-- user to the installation's organization (or refreshes the role Vercel
-- reports, so a demoted team member is demoted here too) and makes it active.
create or replace function private.join_vercel_installation(
  target_installation_id text,
  target_user_id text,
  target_role text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  installation_organization_id uuid;
begin
  if target_role not in ('admin', 'member') then
    raise exception 'invalid role' using errcode = '22023';
  end if;

  select installation.organization_id into installation_organization_id
  from private.vercel_installation as installation
  where installation.installation_id = target_installation_id;

  if installation_organization_id is null then
    return null;
  end if;

  insert into public.memberships (user_id, organization_id, role, last_selected_at)
  values (target_user_id, installation_organization_id, target_role, timezone('utc', now()))
  on conflict (user_id, organization_id) do update
    set role = excluded.role,
        last_selected_at = excluded.last_selected_at;

  return installation_organization_id;
end;
$$;

create or replace function public.join_vercel_installation(
  target_installation_id text,
  target_user_id text,
  target_role text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.join_vercel_installation(target_installation_id, target_user_id, target_role);
$$;

revoke all on function private.join_vercel_installation(text, text, text)
  from public, anon, authenticated;
grant execute on function private.join_vercel_installation(text, text, text) to service_role;
revoke all on function public.join_vercel_installation(text, text, text)
  from public, anon, authenticated;
grant execute on function public.join_vercel_installation(text, text, text) to service_role;
