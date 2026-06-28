create unique index organizations_github_installation_id_key
  on public.organizations (github_installation_id)
  where github_installation_id is not null;

create table private.github_webhook_deliveries (
  delivery_id text primary key
    check (delivery_id ~ '^[A-Za-z0-9-]{1,100}$'),
  event_type text not null
    check (event_type ~ '^[a-z_]{1,80}$'),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  repository_id uuid not null references public.repositories(id) on delete cascade,
  github_installation_id text not null
    check (github_installation_id ~ '^[0-9]{1,20}$'),
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  attempts smallint not null default 1 check (attempts between 1 and 3),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index github_webhook_deliveries_organization_id_idx
  on private.github_webhook_deliveries (organization_id);
create index github_webhook_deliveries_repository_id_idx
  on private.github_webhook_deliveries (repository_id);

alter table private.github_webhook_deliveries enable row level security;
revoke all privileges on table private.github_webhook_deliveries
  from public, anon, authenticated;

create or replace function private.claim_github_webhook_delivery(
  target_delivery_id text,
  target_event_type text,
  target_github_repository_id bigint,
  target_github_installation_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_repository_id uuid;
  target_organization_id uuid;
  claimed boolean;
begin
  if target_delivery_id is null
    or target_delivery_id !~ '^[A-Za-z0-9-]{1,100}$'
    or target_event_type is null
    or target_event_type !~ '^[a-z_]{1,80}$'
    or target_github_repository_id is null
    or target_github_repository_id <= 0
    or target_github_installation_id is null
    or target_github_installation_id !~ '^[0-9]{1,20}$' then
    raise exception 'invalid GitHub delivery' using errcode = '22023';
  end if;

  select r.id, r.organization_id
  into target_repository_id, target_organization_id
  from public.repositories r
  join public.organizations o on o.id = r.organization_id
  where r.github_repo_id = target_github_repository_id
    and r.is_active
    and o.github_installation_id = target_github_installation_id
  for update of r, o;

  if not found then
    raise exception 'GitHub installation and repository are not mapped to one organization'
      using errcode = '42501';
  end if;

  insert into private.github_webhook_deliveries (
    delivery_id,
    event_type,
    organization_id,
    repository_id,
    github_installation_id
  ) values (
    target_delivery_id,
    target_event_type,
    target_organization_id,
    target_repository_id,
    target_github_installation_id
  )
  on conflict (delivery_id) do update
    set status = 'processing',
        attempts = private.github_webhook_deliveries.attempts + 1,
        error_message = null,
        processed_at = null
    where private.github_webhook_deliveries.status = 'failed'
      and private.github_webhook_deliveries.attempts < 3
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

create or replace function private.finish_github_webhook_delivery(
  target_delivery_id text,
  succeeded boolean,
  failure_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.github_webhook_deliveries
  set status = case when succeeded then 'completed' else 'failed' end,
      error_message = case
        when succeeded then null
        else left(coalesce(failure_message, 'Unknown background processing failure'), 1000)
      end,
      processed_at = now()
  where delivery_id = target_delivery_id
    and status = 'processing';

  if not found then
    raise exception 'GitHub delivery is not processing' using errcode = 'P0002';
  end if;
end;
$$;

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
    set name = excluded.name,
        is_active = true
    where public.repositories.organization_id = target_organization_id;

  return repository_count;
end;
$$;

create or replace function public.claim_github_webhook_delivery(
  target_delivery_id text,
  target_event_type text,
  target_github_repository_id bigint,
  target_github_installation_id text
)
returns boolean language sql volatile security invoker set search_path = ''
as $$
  select private.claim_github_webhook_delivery(
    target_delivery_id,
    target_event_type,
    target_github_repository_id,
    target_github_installation_id
  );
$$;

create or replace function public.finish_github_webhook_delivery(
  target_delivery_id text,
  succeeded boolean,
  failure_message text default null
)
returns void language sql volatile security invoker set search_path = ''
as $$
  select private.finish_github_webhook_delivery(
    target_delivery_id, succeeded, failure_message
  );
$$;

create or replace function public.connect_github_installation(
  target_organization_id uuid,
  target_github_account_id bigint,
  target_github_installation_id text,
  target_repositories jsonb
)
returns integer language sql volatile security invoker set search_path = ''
as $$
  select private.connect_github_installation(
    target_organization_id,
    target_github_account_id,
    target_github_installation_id,
    target_repositories
  );
$$;

revoke all on function private.claim_github_webhook_delivery(text, text, bigint, text)
  from public, anon, authenticated;
revoke all on function private.finish_github_webhook_delivery(text, boolean, text)
  from public, anon, authenticated;
revoke all on function private.connect_github_installation(uuid, bigint, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_github_webhook_delivery(text, text, bigint, text)
  from public, anon, authenticated;
revoke all on function public.finish_github_webhook_delivery(text, boolean, text)
  from public, anon, authenticated;
revoke all on function public.connect_github_installation(uuid, bigint, text, jsonb)
  from public, anon, authenticated;

grant execute on function private.claim_github_webhook_delivery(text, text, bigint, text)
  to service_role;
grant execute on function private.finish_github_webhook_delivery(text, boolean, text)
  to service_role;
grant execute on function private.connect_github_installation(uuid, bigint, text, jsonb)
  to service_role;
grant execute on function public.claim_github_webhook_delivery(text, text, bigint, text)
  to service_role;
grant execute on function public.finish_github_webhook_delivery(text, boolean, text)
  to service_role;
grant execute on function public.connect_github_installation(uuid, bigint, text, jsonb)
  to service_role;

-- GitHub fields are now mutated only after trusted GitHub App verification.
revoke update (github_org_id, github_installation_id)
  on public.organizations from authenticated;
