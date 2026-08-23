-- `is_active` carried three unrelated meanings at once: "GitHub still grants this
-- repo", "the user has not hidden it" and "the user connected it by hand". Two bugs
-- followed. (1) Because dismissal had to survive re-sync, ON CONFLICT stopped setting
-- is_active, so a hidden repo could never be restored — not by adjusting App
-- permissions, not even by reinstalling the App. (2) The prune step deactivated every
-- repo missing from the installation, silently killing public repos added through
-- Connect & Scan, which are never part of any installation.
--
-- Split the meanings: `is_active` = reachable, `dismissed_at` = user hid it,
-- `source` = which lifecycle owns the row. Sync now owns only `installation` rows and
-- never touches `dismissed_at`; the user owns `dismissed_at` and can always undo it.

alter table public.repositories
  add column if not exists dismissed_at timestamptz,
  add column if not exists source text not null default 'manual'
    check (source in ('installation', 'manual'));

comment on column public.repositories.dismissed_at is
  'When the user hid this repo from Your apps. Never written by GitHub sync; cleared by Restore.';
comment on column public.repositories.source is
  'Which lifecycle owns the row: installation (pruned by GitHub sync) | manual (Connect & Scan).';

-- Existing rows stay `manual`, so the first sync after this migration cannot prune
-- anything. Rows actually covered by the installation get retagged by the upsert below.

create index if not exists repositories_dismissed_at_idx
  on public.repositories (organization_id)
  where dismissed_at is not null;

create or replace function private.connect_github_installation(
  target_organization_id uuid,
  target_github_account_id bigint,
  target_github_installation_id text,
  target_repositories jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  repository_count integer;
begin
  if target_github_account_id is null or target_github_account_id <= 0
    or target_github_installation_id is null
    or target_github_installation_id !~ '^[0-9]{1,20}$'
    or target_repositories is null
    or jsonb_typeof(target_repositories) <> 'array' then
    raise exception 'invalid GitHub installation mapping' using errcode = '22023';
  end if;

  perform 1 from public.organizations
  where id = target_organization_id
  for update;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.organizations
    where github_installation_id = target_github_installation_id
      and id <> target_organization_id
  ) then
    raise exception 'GitHub installation is already connected to another organization'
      using errcode = '23505';
  end if;

  drop table if exists pg_temp.github_repository_mapping_input;
  create temporary table github_repository_mapping_input (
    github_repo_id bigint primary key,
    full_name text not null
  ) on commit drop;

  insert into github_repository_mapping_input (github_repo_id, full_name)
  select input.id, input.full_name
  from jsonb_to_recordset(target_repositories) as input(id bigint, full_name text)
  where input.id > 0
    and input.full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$';

  get diagnostics repository_count = row_count;
  if repository_count <> jsonb_array_length(target_repositories) then
    raise exception 'invalid or duplicate GitHub repositories' using errcode = '22023';
  end if;

  if exists (
    select 1
    from github_repository_mapping_input input
    join public.repositories r on r.github_repo_id = input.github_repo_id
    where r.organization_id <> target_organization_id
  ) then
    raise exception 'GitHub repository is already connected to another organization'
      using errcode = '23505';
  end if;

  update public.organizations
  set github_org_id = target_github_account_id,
      github_installation_id = target_github_installation_id
  where id = target_organization_id;

  -- Only installation-owned rows follow the installation. Repos added through
  -- Connect & Scan are never in `/installation/repositories` and must survive.
  update public.repositories
  set is_active = false
  where organization_id = target_organization_id
    and source = 'installation'
    and github_repo_id not in (
      select github_repo_id from github_repository_mapping_input
    );

  -- Re-granting a repo makes it reachable again. `dismissed_at` is deliberately
  -- untouched, so a repo the user hid stays hidden until they restore it.
  insert into public.repositories (
    organization_id,
    name,
    github_repo_id,
    is_active,
    source
  )
  select target_organization_id, full_name, github_repo_id, true, 'installation'
  from github_repository_mapping_input
  on conflict (github_repo_id) do update
    set name = excluded.name,
        is_active = true,
        source = 'installation'
    where public.repositories.organization_id = target_organization_id;

  return repository_count;
end;
$$;

notify pgrst, 'reload schema';
