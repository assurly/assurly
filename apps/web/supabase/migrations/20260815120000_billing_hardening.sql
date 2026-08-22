-- Billing hardening:
--   1. Keep api_keys.plan in sync with Stripe-driven org plan (never touch OEM keys).
--   2. One trial per card fingerprint, stored hashed in private schema.

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
    select 1 from private.stripe_webhook_events where event_id = stripe_event_id
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

  insert into private.stripe_webhook_events (
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

  update public.api_keys
  set plan = target_plan
  where organization_id = target_organization_id
    and plan in ('free', 'pro');

  return true;
end;
$$;

revoke all on function private.process_stripe_billing_event(text, text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function private.process_stripe_billing_event(text, text, uuid, text, text, text, text)
  to service_role;

create table if not exists private.stripe_trial_card_fingerprints (
  fingerprint_hash text primary key check (fingerprint_hash ~ '^[a-f0-9]{64}$'),
  stripe_customer_id text not null check (stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$'),
  organization_id uuid not null references public.organizations (id),
  stripe_subscription_id text not null check (stripe_subscription_id ~ '^sub_[A-Za-z0-9_]+$'),
  created_at timestamptz not null default timezone('utc', now())
);

revoke all on table private.stripe_trial_card_fingerprints from public, anon, authenticated;

create or replace function private.claim_trial_card_fingerprint(
  fingerprint_hash text,
  stripe_customer_id text,
  organization_id uuid,
  stripe_subscription_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted boolean;
  existing_subscription_id text;
begin
  if fingerprint_hash is null or fingerprint_hash !~ '^[a-f0-9]{64}$'
    or stripe_customer_id is null or stripe_customer_id !~ '^cus_[A-Za-z0-9_]+$'
    or organization_id is null
    or stripe_subscription_id is null or stripe_subscription_id !~ '^sub_[A-Za-z0-9_]+$' then
    raise exception 'invalid trial card fingerprint claim' using errcode = '22023';
  end if;

  insert into private.stripe_trial_card_fingerprints (
    fingerprint_hash,
    stripe_customer_id,
    organization_id,
    stripe_subscription_id
  ) values (
    fingerprint_hash,
    stripe_customer_id,
    organization_id,
    stripe_subscription_id
  )
  on conflict (fingerprint_hash) do nothing
  returning true into inserted;

  if coalesce(inserted, false) then
    return true;
  end if;

  select fingerprints.stripe_subscription_id
  into existing_subscription_id
  from private.stripe_trial_card_fingerprints as fingerprints
  where fingerprints.fingerprint_hash = claim_trial_card_fingerprint.fingerprint_hash;

  return existing_subscription_id = claim_trial_card_fingerprint.stripe_subscription_id;
end;
$$;

create or replace function public.claim_trial_card_fingerprint(
  fingerprint_hash text,
  stripe_customer_id text,
  organization_id uuid,
  stripe_subscription_id text
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.claim_trial_card_fingerprint(
    fingerprint_hash,
    stripe_customer_id,
    organization_id,
    stripe_subscription_id
  );
$$;

revoke all on function private.claim_trial_card_fingerprint(text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.claim_trial_card_fingerprint(text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function private.claim_trial_card_fingerprint(text, text, uuid, text)
  to service_role;
grant execute on function public.claim_trial_card_fingerprint(text, text, uuid, text)
  to service_role;
