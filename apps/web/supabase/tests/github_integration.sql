begin;

set local statement_timeout = '10s';

do $$
begin
  if has_function_privilege(
      'anon', 'public.claim_github_webhook_delivery(text,text,bigint,text)', 'EXECUTE'
    ) or has_function_privilege(
      'authenticated', 'public.claim_github_webhook_delivery(text,text,bigint,text)', 'EXECUTE'
    ) or not has_function_privilege(
      'service_role', 'public.claim_github_webhook_delivery(text,text,bigint,text)', 'EXECUTE'
    ) or has_function_privilege(
      'authenticated', 'public.connect_github_installation(uuid,bigint,text,jsonb)', 'EXECUTE'
    ) then
    raise exception 'GitHub RPC privileges are not least privilege';
  end if;

  if has_table_privilege('anon', 'private.github_webhook_deliveries', 'SELECT')
    or has_table_privilege('authenticated', 'private.github_webhook_deliveries', 'SELECT')
    or has_column_privilege(
      'authenticated', 'public.organizations', 'github_installation_id', 'UPDATE'
    ) then
    raise exception 'GitHub mapping or delivery ledger is exposed';
  end if;
end
$$;

insert into public.organizations (id, name) values
  ('60000000-0000-0000-0000-000000000006', 'GitHub tenant A'),
  ('70000000-0000-0000-0000-000000000007', 'GitHub tenant B');

set local role service_role;

do $$
declare
  connected integer;
  claimed boolean;
  blocked boolean;
begin
  select public.connect_github_installation(
    '60000000-0000-0000-0000-000000000006',
    6001,
    '60001',
    '[{"id":9600000001,"full_name":"tenant-a/private"}]'::jsonb
  ) into connected;
  if connected <> 1 then
    raise exception 'tenant A GitHub installation was not mapped';
  end if;

  select public.connect_github_installation(
    '70000000-0000-0000-0000-000000000007',
    7001,
    '70001',
    '[{"id":9700000001,"full_name":"tenant-b/private"}]'::jsonb
  ) into connected;

  blocked := false;
  begin
    perform public.connect_github_installation(
      '70000000-0000-0000-0000-000000000007',
      6001,
      '60001',
      '[{"id":9700000001,"full_name":"tenant-b/private"}]'::jsonb
    );
  exception when unique_violation then
    blocked := true;
  end;
  if not blocked then
    raise exception 'one installation was mapped to two tenants';
  end if;

  blocked := false;
  begin
    perform public.connect_github_installation(
      '70000000-0000-0000-0000-000000000007',
      7001,
      '70001',
      '[{"id":9600000001,"full_name":"tenant-a/private"}]'::jsonb
    );
  exception when unique_violation then
    blocked := true;
  end;
  if not blocked then
    raise exception 'one repository was mapped to two tenants';
  end if;

  select public.claim_github_webhook_delivery(
    'delivery-sql-1', 'pull_request', 9600000001, '60001'
  ) into claimed;
  if not claimed then
    raise exception 'valid delivery was not claimed';
  end if;

  select public.claim_github_webhook_delivery(
    'delivery-sql-1', 'pull_request', 9600000001, '60001'
  ) into claimed;
  if claimed then
    raise exception 'duplicate delivery was claimed twice';
  end if;

  select public.claim_github_webhook_delivery(
    'delivery-sql-failed', 'pull_request', 9600000001, '60001'
  ) into claimed;
  perform public.finish_github_webhook_delivery(
    'delivery-sql-failed', false, 'expected test failure'
  );
  select public.claim_github_webhook_delivery(
    'delivery-sql-failed', 'pull_request', 9600000001, '60001'
  ) into claimed;
  if claimed then
    raise exception 'failed delivery replay was claimed twice';
  end if;

  blocked := false;
  begin
    perform public.claim_github_webhook_delivery(
      'delivery-sql-foreign', 'pull_request', 9600000001, '70001'
    );
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'foreign installation claimed tenant A repository';
  end if;

  perform public.finish_github_webhook_delivery('delivery-sql-1', true, null);

  update public.repositories
  set is_active = false
  where github_repo_id = 9600000001;

  select public.connect_github_installation(
    '60000000-0000-0000-0000-000000000006',
    6001,
    '60001',
    '[{"id":9600000001,"full_name":"tenant-a/private"}]'::jsonb
  ) into connected;
  if connected <> 1 then
    raise exception 'tenant A GitHub installation remap failed';
  end if;
  if exists (
    select 1 from public.repositories
    where github_repo_id = 9600000001
      and is_active
  ) then
    raise exception 'dismissed repository was resurrected by GitHub install sync';
  end if;
end
$$;

reset role;

do $$
begin
  if not exists (
    select 1 from private.github_webhook_deliveries
    where delivery_id = 'delivery-sql-1'
      and organization_id = '60000000-0000-0000-0000-000000000006'
      and status = 'completed'
  ) then
    raise exception 'delivery was not finalized for tenant A';
  end if;
end
$$;

select 'GitHub integration SQL tests passed' as result;

rollback;
