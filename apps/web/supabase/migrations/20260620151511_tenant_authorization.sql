-- Tenant authorization helpers deliberately live outside the exposed public schema.
create schema if not exists private;

create or replace function private.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships
    where organization_id = target_organization_id
      and user_id = (select auth.uid())::text
  );
$$;

create or replace function private.is_organization_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships
    where organization_id = target_organization_id
      and user_id = (select auth.uid())::text
      and role = 'admin'
  );
$$;

create or replace function private.can_access_repository(target_repository_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.repositories r
    join public.memberships m on m.organization_id = r.organization_id
    where r.id = target_repository_id
      and m.user_id = (select auth.uid())::text
  );
$$;

create or replace function private.can_access_scan(target_scan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.scans s
    join public.repositories r on r.id = s.repository_id
    join public.memberships m on m.organization_id = r.organization_id
    where s.id = target_scan_id
      and m.user_id = (select auth.uid())::text
  );
$$;

revoke all on function private.is_organization_member(uuid) from public;
revoke all on function private.is_organization_admin(uuid) from public;
revoke all on function private.can_access_repository(uuid) from public;
revoke all on function private.can_access_scan(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_organization_member(uuid) to authenticated;
grant execute on function private.is_organization_admin(uuid) to authenticated;
grant execute on function private.can_access_repository(uuid) to authenticated;
grant execute on function private.can_access_scan(uuid) to authenticated;

drop policy if exists select_org_member on public.organizations;
drop policy if exists select_membership_member on public.memberships;
drop policy if exists select_repository_member on public.repositories;
drop policy if exists select_scan_member on public.scans;
drop policy if exists select_finding_member on public.scan_findings;

create policy select_org_member on public.organizations
for select to authenticated
using (private.is_organization_member(id));

create policy update_org_admin on public.organizations
for update to authenticated
using (private.is_organization_admin(id))
with check (private.is_organization_admin(id));

create policy select_membership_member on public.memberships
for select to authenticated
using (private.is_organization_member(organization_id));

create policy select_repository_member on public.repositories
for select to authenticated
using (private.is_organization_member(organization_id));

create policy insert_repository_admin on public.repositories
for insert to authenticated
with check (private.is_organization_admin(organization_id));

create policy update_repository_admin on public.repositories
for update to authenticated
using (private.is_organization_admin(organization_id))
with check (private.is_organization_admin(organization_id));

create policy delete_repository_admin on public.repositories
for delete to authenticated
using (private.is_organization_admin(organization_id));

create policy select_scan_member on public.scans
for select to authenticated
using (private.can_access_repository(repository_id));

create policy insert_scan_member on public.scans
for insert to authenticated
with check (private.can_access_repository(repository_id));

create policy select_finding_member on public.scan_findings
for select to authenticated
using (private.can_access_scan(scan_id));

create policy insert_finding_member on public.scan_findings
for insert to authenticated
with check (private.can_access_scan(scan_id));

-- User-facing code may only mutate GitHub connection fields on organizations.
revoke update on table public.organizations from authenticated;
grant update (github_org_id, github_installation_id) on table public.organizations to authenticated;
grant select on table public.organizations, public.memberships, public.repositories,
  public.scans, public.scan_findings to authenticated;
grant insert on table public.repositories, public.scans, public.scan_findings to authenticated;

create index if not exists memberships_user_id_idx on public.memberships (user_id);
create index if not exists memberships_organization_id_idx on public.memberships (organization_id);
create index if not exists repositories_organization_id_idx on public.repositories (organization_id);
create index if not exists scans_repository_id_idx on public.scans (repository_id);
create index if not exists scan_findings_scan_id_idx on public.scan_findings (scan_id);

-- Atomic first-workspace creation avoids granting direct INSERT on tenant tables.
create or replace function public.create_organization_for_current_user(organization_name text)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization public.organizations;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if organization_name is null or length(trim(organization_name)) < 1 then
    raise exception 'organization name is required';
  end if;
  if exists (
    select 1 from public.memberships
    where user_id = (select auth.uid())::text
  ) then
    raise exception 'user already belongs to an organization';
  end if;

  insert into public.organizations (name)
  values (left(trim(organization_name), 120))
  returning * into new_organization;

  insert into public.memberships (user_id, organization_id, role)
  values ((select auth.uid())::text, new_organization.id, 'admin');

  return new_organization;
end;
$$;

revoke all on function public.create_organization_for_current_user(text) from public;
grant execute on function public.create_organization_for_current_user(text) to authenticated;
