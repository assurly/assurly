begin;

set local statement_timeout = '10s';

do $$
begin
  if has_function_privilege(
      'anon',
      'public.process_stripe_billing_event(text,text,uuid,text,text,text,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.process_stripe_billing_event(text,text,uuid,text,text,text,text)',
      'EXECUTE'
    ) or not has_function_privilege(
      'service_role',
      'public.process_stripe_billing_event(text,text,uuid,text,text,text,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'anon',
      'public.claim_trial_card_fingerprint(text,text,uuid,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.claim_trial_card_fingerprint(text,text,uuid,text)',
      'EXECUTE'
    ) or not has_function_privilege(
      'service_role',
      'public.claim_trial_card_fingerprint(text,text,uuid,text)',
      'EXECUTE'
    ) then
    raise exception 'Stripe billing RPC privileges are not least privilege';
  end if;
end
$$;

insert into public.organizations (id, name) values
  ('30000000-0000-0000-0000-000000000003', 'Stripe tenant A'),
  ('40000000-0000-0000-0000-000000000004', 'Stripe tenant B');

insert into public.api_keys (organization_id, label, key_prefix, key_hash, plan) values
  (
    '30000000-0000-0000-0000-000000000003',
    'promoted',
    'ask_live_ab12cd',
    repeat('a', 64),
    'free'
  ),
  (
    '30000000-0000-0000-0000-000000000003',
    'oem-keep',
    'ask_live_oemkey',
    repeat('b', 64),
    'oem'
  );

set local role service_role;

do $$
declare
  applied boolean;
  blocked boolean;
  claimed boolean;
begin
  select public.process_stripe_billing_event(
    'evt_sql_1',
    'checkout.session.completed',
    '30000000-0000-0000-0000-000000000003',
    'pro',
    'cus_tenant_a',
    'sub_tenant_a',
    'price_monthly_server'
  ) into applied;

  if not applied or not exists (
    select 1 from public.organizations
    where id = '30000000-0000-0000-0000-000000000003'
      and billing_plan = 'pro'
      and stripe_customer_id = 'cus_tenant_a'
  ) or (select plan from public.api_keys where key_prefix = 'ask_live_ab12cd') <> 'pro'
    or (select plan from public.api_keys where key_prefix = 'ask_live_oemkey') <> 'oem' then
    raise exception 'valid Stripe event was not applied atomically';
  end if;

  select public.process_stripe_billing_event(
    'evt_sql_1',
    'customer.subscription.deleted',
    '40000000-0000-0000-0000-000000000004',
    'pro',
    'cus_tenant_b',
    'sub_tenant_b',
    'price_yearly_server'
  ) into applied;

  if applied or (select billing_plan from public.organizations
    where id = '30000000-0000-0000-0000-000000000003') <> 'pro'
    or (select billing_plan from public.organizations
      where id = '40000000-0000-0000-0000-000000000004') <> 'free'
    or (select stripe_customer_id from public.organizations
      where id = '40000000-0000-0000-0000-000000000004') is not null then
    raise exception 'tenant-foreign duplicate Stripe event changed billing';
  end if;

  blocked := false;
  begin
    perform public.process_stripe_billing_event(
      'evt_sql_foreign',
      'customer.subscription.updated',
      '30000000-0000-0000-0000-000000000003',
      'free',
      'cus_tenant_b',
      'sub_tenant_b',
      'price_yearly_server'
    );
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked or (select billing_plan from public.organizations
    where id = '30000000-0000-0000-0000-000000000003') <> 'pro' then
    raise exception 'foreign Stripe customer changed tenant billing';
  end if;

  blocked := false;
  begin
    perform public.process_stripe_billing_event(
      'evt_sql_unknown_org',
      'checkout.session.completed',
      '50000000-0000-0000-0000-000000000005',
      'pro',
      'cus_unknown',
      'sub_unknown',
      'price_monthly_server'
    );
  exception when no_data_found then
    blocked := true;
  end;
  if not blocked then
    raise exception 'unknown organization Stripe event was accepted';
  end if;

  select public.claim_trial_card_fingerprint(
    repeat('c', 64),
    'cus_tenant_a',
    '30000000-0000-0000-0000-000000000003',
    'sub_tenant_a'
  ) into claimed;
  if not claimed then
    raise exception 'first fingerprint claim should win';
  end if;

  select public.claim_trial_card_fingerprint(
    repeat('c', 64),
    'cus_tenant_a',
    '30000000-0000-0000-0000-000000000003',
    'sub_tenant_a'
  ) into claimed;
  if not claimed then
    raise exception 'same-subscription fingerprint retry should keep the trial';
  end if;

  select public.claim_trial_card_fingerprint(
    repeat('c', 64),
    'cus_tenant_b',
    '40000000-0000-0000-0000-000000000004',
    'sub_tenant_b'
  ) into claimed;
  if claimed then
    raise exception 'reused fingerprint was allowed a second trial';
  end if;

  if (select count(*) from private.stripe_webhook_events) <> 1 then
    raise exception 'rejected or duplicate events polluted the idempotency ledger';
  end if;
end
$$;

reset role;

select 'Stripe billing SQL tests passed' as result;

rollback;
