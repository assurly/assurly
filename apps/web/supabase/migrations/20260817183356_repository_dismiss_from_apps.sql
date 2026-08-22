-- Your apps: dismissing a connected repo must survive GitHub App re-sync.
-- Previously ON CONFLICT set is_active = true, so Remove was undone on the next
-- installation callback. Keep user-hidden rows hidden; only brand-new mapping
-- rows start active. Connect & Scan reactivates explicitly.

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

  update public.repositories
  set is_active = false
  where organization_id = target_organization_id
    and github_repo_id not in (
      select github_repo_id from github_repository_mapping_input
    );

  insert into public.repositories (
    organization_id,
    name,
    github_repo_id,
    is_active
  )
  select target_organization_id, full_name, github_repo_id, true
  from github_repository_mapping_input
  on conflict (github_repo_id) do update
    set name = excluded.name
    where public.repositories.organization_id = target_organization_id;

  return repository_count;
end;
$$;
