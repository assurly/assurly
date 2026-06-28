begin;

set local statement_timeout = '10s';

do $$
begin
  if has_function_privilege(
      'anon', 'public.consume_api_rate_limit(text,text,integer,integer)', 'EXECUTE'
    ) or has_function_privilege(
      'authenticated', 'public.consume_api_rate_limit(text,text,integer,integer)', 'EXECUTE'
    ) or not has_function_privilege(
      'service_role', 'public.consume_api_rate_limit(text,text,integer,integer)', 'EXECUTE'
    ) or has_table_privilege('authenticated', 'private.api_rate_limits', 'SELECT') then
    raise exception 'API rate limit privileges are not least privilege';
  end if;
end
$$;

set local role service_role;

do $$
declare
  result jsonb;
  key_a text := repeat('a', 64);
  key_b text := repeat('b', 64);
begin
  select public.consume_api_rate_limit(key_a, 'sql:test:ip', 2, 60) into result;
  if not (result->>'allowed')::boolean or (result->>'remaining')::integer <> 1 then
    raise exception 'first request was not admitted';
  end if;

  select public.consume_api_rate_limit(key_a, 'sql:test:ip', 2, 60) into result;
  if not (result->>'allowed')::boolean or (result->>'remaining')::integer <> 0 then
    raise exception 'second request was not admitted';
  end if;

  select public.consume_api_rate_limit(key_a, 'sql:test:ip', 2, 60) into result;
  if (result->>'allowed')::boolean then
    raise exception 'rate limit did not reject excess request';
  end if;

  select public.consume_api_rate_limit(key_b, 'sql:test:ip', 2, 60) into result;
  if not (result->>'allowed')::boolean then
    raise exception 'one identity exhausted another identity rate limit';
  end if;

  begin
    perform public.consume_api_rate_limit('raw-user-input', 'sql:test:ip', 2, 60);
    raise exception 'invalid unhashed identity was accepted';
  exception when invalid_parameter_value then
    null;
  end;
end
$$;

reset role;

select 'API security SQL tests passed' as result;

rollback;
