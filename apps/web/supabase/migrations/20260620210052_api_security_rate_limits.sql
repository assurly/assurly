create table private.api_rate_limits (
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  route_id text not null check (route_id ~ '^[a-z0-9:_-]{1,120}$'),
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  expires_at timestamptz not null,
  primary key (key_hash, route_id, window_started_at)
);

create index api_rate_limits_expires_at_idx
  on private.api_rate_limits (expires_at);

alter table private.api_rate_limits enable row level security;
revoke all on table private.api_rate_limits from public, anon, authenticated;

create or replace function private.consume_api_rate_limit(
  target_key_hash text,
  target_route_id text,
  target_limit integer,
  target_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_epoch bigint := floor(extract(epoch from clock_timestamp()))::bigint;
  window_epoch bigint;
  window_start timestamptz;
  reset_epoch bigint;
  consumed integer;
begin
  if target_key_hash is null or target_key_hash !~ '^[a-f0-9]{64}$'
    or target_route_id is null or target_route_id !~ '^[a-z0-9:_-]{1,120}$'
    or target_limit is null or target_limit not between 1 and 10000
    or target_window_seconds is null or target_window_seconds not between 1 and 86400 then
    raise exception 'invalid API rate limit input' using errcode = '22023';
  end if;

  window_epoch := (current_epoch / target_window_seconds) * target_window_seconds;
  window_start := to_timestamp(window_epoch);
  reset_epoch := window_epoch + target_window_seconds;

  delete from private.api_rate_limits
  where key_hash = target_key_hash
    and route_id = target_route_id
    and expires_at <= clock_timestamp();

  insert into private.api_rate_limits (
    key_hash,
    route_id,
    window_started_at,
    request_count,
    expires_at
  ) values (
    target_key_hash,
    target_route_id,
    window_start,
    1,
    to_timestamp(reset_epoch)
  )
  on conflict (key_hash, route_id, window_started_at) do update
    set request_count = private.api_rate_limits.request_count + 1
  returning request_count into consumed;

  return jsonb_build_object(
    'allowed', consumed <= target_limit,
    'remaining', greatest(0, target_limit - consumed),
    'reset_at', reset_epoch
  );
end;
$$;

create or replace function public.consume_api_rate_limit(
  target_key_hash text,
  target_route_id text,
  target_limit integer,
  target_window_seconds integer
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.consume_api_rate_limit(
    target_key_hash,
    target_route_id,
    target_limit,
    target_window_seconds
  );
$$;

revoke all on function private.consume_api_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.consume_api_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function private.consume_api_rate_limit(text, text, integer, integer)
  to service_role;
grant execute on function public.consume_api_rate_limit(text, text, integer, integer)
  to service_role;
