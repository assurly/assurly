-- Run with the Supabase SQL runner against a disposable branch or inside the
-- transaction below. Every fixture and authorized write is rolled back.
begin;

set local statement_timeout = '10s';

do $$
declare
  missing_fk_indexes integer;
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'organizations'
        and column_name = 'github_org_id') <> 'bigint' then
    raise exception 'organizations.github_org_id must be BIGINT';
  end if;

  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'repositories'
        and column_name = 'github_repo_id') <> 'bigint' then
    raise exception 'repositories.github_repo_id must be BIGINT';
  end if;

  select count(*) into missing_fk_indexes
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where c.contype = 'f'
    and c.connamespace = 'public'::regnamespace
    and not exists (
      select 1 from pg_index i
      where i.indrelid = c.conrelid
        and i.indisvalid
        and i.indpred is null
        and (i.indkey::smallint[])[0] = a.attnum
    );
  if missing_fk_indexes <> 0 then
    raise exception '% foreign keys are missing a leading index', missing_fk_indexes;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'memberships_role_check')
    or not exists (select 1 from pg_constraint where conname = 'organizations_billing_plan_check')
    or not exists (select 1 from pg_constraint where conname = 'scans_status_check')
    or not exists (select 1 from pg_constraint where conname = 'scan_findings_severity_check') then
    raise exception 'required domain CHECK constraints are missing';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('organizations', 'memberships', 'repositories', 'scans', 'scan_findings')
      and grantee = 'anon'
  ) then
    raise exception 'anon must not have tenant table privileges';
  end if;

  if has_table_privilege('authenticated', 'public.organizations', 'INSERT')
    or has_table_privilege('authenticated', 'public.memberships', 'INSERT')
    or has_table_privilege('authenticated', 'public.scans', 'UPDATE')
    or has_table_privilege('authenticated', 'public.scan_findings', 'DELETE') then
    raise exception 'authenticated has an unexpected tenant table privilege';
  end if;

  if has_column_privilege(
      'authenticated', 'public.organizations', 'github_installation_id', 'UPDATE'
    ) or has_column_privilege(
      'authenticated', 'public.organizations', 'billing_plan', 'UPDATE'
    ) then
    raise exception 'organization column grants are not least privilege';
  end if;

  if (select prosecdef from pg_proc
      where oid = 'public.create_organization_for_current_user(text)'::regprocedure) then
    raise exception 'public onboarding RPC must be SECURITY INVOKER';
  end if;

  if not (select prosecdef from pg_proc
          where oid = 'private.create_organization_for_current_user(text)'::regprocedure) then
    raise exception 'private onboarding implementation must be SECURITY DEFINER';
  end if;
end
$$;

insert into public.organizations (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'Tenant A SQL test'),
  ('20000000-0000-0000-0000-000000000002', 'Tenant B SQL test');

insert into public.memberships (id, user_id, organization_id, role) values
  ('10000000-0000-0000-0000-000000000011', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', 'admin'),
  ('20000000-0000-0000-0000-000000000022', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '20000000-0000-0000-0000-000000000002', 'admin');

insert into public.repositories (id, organization_id, name, github_repo_id) values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'tenant-a/sql-test', 9000000001),
  ('22000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'tenant-b/sql-test', 9000000002);

insert into public.scans (id, repository_id, commit_sha, branch, status) values
  ('11100000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'tenant-a-sha', 'main', 'success'),
  ('22200000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000002', 'tenant-b-sha', 'main', 'failed');

insert into public.scan_findings (id, scan_id, rule_id, severity, file_path, message) values
  ('11110000-0000-0000-0000-000000000001', '11100000-0000-0000-0000-000000000001', 'test-a', 'warning', 'a.ts', 'A'),
  ('22220000-0000-0000-0000-000000000002', '22200000-0000-0000-0000-000000000002', 'test-b', 'error', 'b.ts', 'B');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

do $$
declare
  affected integer;
  blocked boolean;
begin
  if (select count(*) from public.organizations
      where id in ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002')) <> 1
    or (select count(*) from public.repositories
        where id in ('11000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000002')) <> 1
    or (select count(*) from public.scans
        where id in ('11100000-0000-0000-0000-000000000001', '22200000-0000-0000-0000-000000000002')) <> 1
    or (select count(*) from public.scan_findings
        where id in ('11110000-0000-0000-0000-000000000001', '22220000-0000-0000-0000-000000000002')) <> 1 then
    raise exception 'tenant A can read tenant B data';
  end if;

  insert into public.scans (
    id, repository_id, commit_sha, branch, status, error_count, warning_count
  ) values (
    '11100000-0000-0000-0000-000000000099',
    '11000000-0000-0000-0000-000000000001',
    'authorized-sha', 'main', 'success', 0, 0
  );

  blocked := false;
  begin
    insert into public.scans (id, repository_id, commit_sha, branch, status)
    values (
      '22200000-0000-0000-0000-000000000099',
      '22000000-0000-0000-0000-000000000002',
      'forbidden-sha', 'main', 'success'
    );
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'tenant A inserted a scan into tenant B';
  end if;

  begin
    insert into public.scans (id, repository_id, commit_sha, branch, status)
    values (
      '11100000-0000-0000-0000-000000000088',
      '11000000-0000-0000-0000-000000000001',
      'invalid-sha', 'main', 'unknown'
    );
    raise exception 'invalid scan status was accepted';
  exception when check_violation then
    null;
  end;

  begin
    update public.organizations
    set github_installation_id = 'untrusted-installation'
    where id = '10000000-0000-0000-0000-000000000001';
    raise exception 'authenticated user changed trusted GitHub mapping';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.organizations
    set billing_plan = 'pro'
    where id = '10000000-0000-0000-0000-000000000001';
    raise exception 'authenticated user changed a billing field';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.memberships (user_id, organization_id, role)
    values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '20000000-0000-0000-0000-000000000002',
      'admin'
    );
    raise exception 'authenticated user inserted a membership directly';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';

do $$
declare
  created_organization public.organizations;
begin
  select * into created_organization
  from public.create_organization_for_current_user('Tenant C RPC test');

  if created_organization.id is null
    or not exists (
      select 1 from public.memberships
      where organization_id = created_organization.id
        and user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
        and role = 'admin'
    ) then
    raise exception 'onboarding RPC did not atomically create its admin membership';
  end if;

  begin
    perform public.create_organization_for_current_user('Duplicate workspace');
    raise exception 'onboarding RPC allowed a second organization';
  exception when unique_violation then
    null;
  end;
end
$$;

reset role;

select 'tenant isolation SQL tests passed' as result;

rollback;
