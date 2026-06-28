create table public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null check (length(event_type) between 1 and 120),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stripe_customer_id text not null check (stripe_customer_id like 'cus\_%' escape '\'),
  stripe_subscription_id text not null check (stripe_subscription_id like 'sub\_%' escape '\'),
  stripe_price_id text not null check (stripe_price_id like 'price\_%' escape '\'),
  billing_plan text not null check (billing_plan in ('free', 'pro')),
  processed_at timestamptz not null default now()
);

comment on table public.stripe_webhook_events is
  'Server-only idempotency ledger for successfully applied Stripe billing events.';

create index stripe_webhook_events_organization_id_idx
  on public.stripe_webhook_events (organization_id);

alter table public.stripe_webhook_events enable row level security;
revoke all privileges on table public.stripe_webhook_events from public, anon, authenticated;

create or replace function private.process_stripe_billing_event(
  stripe_event_id text,
  stripe_event_type text,
  target_organization_id uuid,
  target_plan text,
  target_stripe_customer_id text,
  target_stripe_subscription_id text,
  target_stripe_price_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_customer_id text;
  event_was_inserted boolean;
begin
  if stripe_event_id is null or stripe_event_id !~ '^evt_[A-Za-z0-9_]+$'
    or stripe_event_type is null or length(stripe_event_type) > 120
    or target_plan not in ('free', 'pro')
    or target_stripe_customer_id is null or target_stripe_customer_id !~ '^cus_[A-Za-z0-9_]+$'
    or target_stripe_subscription_id is null or target_stripe_subscription_id !~ '^sub_[A-Za-z0-9_]+$'
    or target_stripe_price_id is null or target_stripe_price_id !~ '^price_[A-Za-z0-9_]+$' then
    raise exception 'invalid Stripe billing event' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.stripe_webhook_events where event_id = stripe_event_id
  ) then
    return false;
  end if;

  select stripe_customer_id
  into existing_customer_id
  from public.organizations
  where id = target_organization_id
  for update;

  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  if existing_customer_id is not null
    and existing_customer_id <> target_stripe_customer_id then
    raise exception 'Stripe customer belongs to another organization' using errcode = '42501';
  end if;

  insert into public.stripe_webhook_events (
    event_id,
    event_type,
    organization_id,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_price_id,
    billing_plan
  ) values (
    stripe_event_id,
    stripe_event_type,
    target_organization_id,
    target_stripe_customer_id,
    target_stripe_subscription_id,
    target_stripe_price_id,
    target_plan
  )
  on conflict (event_id) do nothing
  returning true into event_was_inserted;

  if coalesce(event_was_inserted, false) is false then
    return false;
  end if;

  update public.organizations
  set billing_plan = target_plan,
      stripe_customer_id = coalesce(stripe_customer_id, target_stripe_customer_id)
  where id = target_organization_id;

  return true;
end;
$$;

create or replace function public.process_stripe_billing_event(
  stripe_event_id text,
  stripe_event_type text,
  target_organization_id uuid,
  target_plan text,
  target_stripe_customer_id text,
  target_stripe_subscription_id text,
  target_stripe_price_id text
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.process_stripe_billing_event(
    stripe_event_id,
    stripe_event_type,
    target_organization_id,
    target_plan,
    target_stripe_customer_id,
    target_stripe_subscription_id,
    target_stripe_price_id
  );
$$;

revoke all on function private.process_stripe_billing_event(text, text, uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.process_stripe_billing_event(text, text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function private.process_stripe_billing_event(text, text, uuid, text, text, text, text)
  to service_role;
grant execute on function public.process_stripe_billing_event(text, text, uuid, text, text, text, text)
  to service_role;
