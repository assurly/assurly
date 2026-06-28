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
  on conflict (delivery_id) do nothing
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

revoke all on function private.claim_github_webhook_delivery(text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function private.claim_github_webhook_delivery(text, text, bigint, text)
  to service_role;
