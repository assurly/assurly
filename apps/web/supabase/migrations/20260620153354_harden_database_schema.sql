-- Keep external identifiers lossless. GitHub documents numeric IDs as values that
-- can outgrow PostgreSQL INTEGER even though they remain safe JavaScript numbers.
alter table public.organizations
  alter column github_org_id type bigint using github_org_id::bigint;

alter table public.repositories
  alter column github_repo_id type bigint using github_repo_id::bigint;

-- Constrain every text-backed application enum and reject impossible counters.
alter table public.memberships
  add constraint memberships_role_check
  check (role in ('admin', 'member')) not valid;

alter table public.organizations
  add constraint organizations_billing_plan_check
  check (billing_plan in ('free', 'pro')) not valid;

alter table public.scans
  add constraint scans_status_check
  check (status in ('success', 'failed')) not valid,
  add constraint scans_error_count_check
  check (error_count >= 0) not valid,
  add constraint scans_warning_count_check
  check (warning_count >= 0) not valid;

alter table public.scan_findings
  add constraint scan_findings_severity_check
  check (severity in ('error', 'warning')) not valid,
  add constraint scan_findings_line_number_check
  check (line_number is null or line_number >= 1) not valid;

alter table public.memberships validate constraint memberships_role_check;
alter table public.organizations validate constraint organizations_billing_plan_check;
alter table public.scans validate constraint scans_status_check;
alter table public.scans validate constraint scans_error_count_check;
alter table public.scans validate constraint scans_warning_count_check;
alter table public.scan_findings validate constraint scan_findings_severity_check;
alter table public.scan_findings validate constraint scan_findings_line_number_check;

-- Every foreign-key column needs a leading btree index for parent deletes and
-- tenant/RLS lookups. IF NOT EXISTS keeps this migration safe after schema repair.
create index if not exists memberships_organization_id_idx
  on public.memberships (organization_id);
create index if not exists repositories_organization_id_idx
  on public.repositories (organization_id);
create index if not exists scans_repository_id_idx
  on public.scans (repository_id);
create index if not exists scan_findings_scan_id_idx
  on public.scan_findings (scan_id);

-- The unique index already starts with user_id, so the standalone index is
-- redundant and creates avoidable write amplification.
drop index if exists public.memberships_user_id_idx;

-- RLS helper functions cache auth.uid() through an initPlan. They remain in an
-- unexposed schema and use an empty search_path to prevent object shadowing.
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

-- Move privileged onboarding work out of the exposed public schema. The public
-- function is now a SECURITY INVOKER facade callable only by signed-in users.
create or replace function private.create_organization_for_current_user(organization_name text)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization public.organizations;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if organization_name is null or length(trim(organization_name)) < 1 then
    raise exception 'organization name is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.memberships
    where user_id = (select auth.uid())::text
  ) then
    raise exception 'user already belongs to an organization' using errcode = '23505';
  end if;

  insert into public.organizations (name)
  values (left(trim(organization_name), 120))
  returning * into new_organization;

  insert into public.memberships (user_id, organization_id, role)
  values ((select auth.uid())::text, new_organization.id, 'admin');

  return new_organization;
end;
$$;

create or replace function public.create_organization_for_current_user(organization_name text)
returns public.organizations
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_organization_for_current_user(organization_name);
$$;

revoke all on function private.create_organization_for_current_user(text) from public, anon;
grant execute on function private.create_organization_for_current_user(text) to authenticated;
revoke all on function public.create_organization_for_current_user(text) from public, anon;
grant execute on function public.create_organization_for_current_user(text) to authenticated;

-- Replace permissive default table privileges with the minimum used by the app.
revoke all privileges on table
  public.organizations,
  public.memberships,
  public.repositories,
  public.scans,
  public.scan_findings
from anon, authenticated;

grant select on table
  public.organizations,
  public.memberships,
  public.repositories,
  public.scans,
  public.scan_findings
to authenticated;

grant insert on table
  public.repositories,
  public.scans,
  public.scan_findings
to authenticated;

grant update (github_org_id, github_installation_id)
on table public.organizations
to authenticated;

-- Keep RLS enabled even if the baseline was installed manually.
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.repositories enable row level security;
alter table public.scans enable row level security;
alter table public.scan_findings enable row level security;
