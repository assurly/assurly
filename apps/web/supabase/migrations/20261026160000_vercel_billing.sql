-- Vercel Marketplace billing (Phase 4 of docs/roadmap/live-lock-native-integration.md).
--
-- A team that installs Live Lock from the Marketplace pays through its Vercel
-- invoice, never through Stripe. Billing is monthly in arrears: on the first
-- days of a month Assurly invoices the previous calendar month (UTC), prorated
-- by the time the installation spent on Pro. Plan changes are logged so the
-- amount can be recomputed at any time; invoices are logged so none is sent
-- twice. An unpaid invoice that Vercel marks overdue (15 days) turns Pro off
-- until it is paid; nothing is deleted.

-- ---------------------------------------------------------------------------
-- Who bills a workspace. Null keeps the existing meaning: Stripe (or free).
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column if not exists billing_source text
    check (billing_source is null or billing_source in ('stripe', 'vercel'));

update public.organizations as organization
  set billing_source = 'vercel'
  from private.vercel_installation as installation
  where installation.organization_id = organization.id;

-- ---------------------------------------------------------------------------
-- Installation state for billing.
-- ---------------------------------------------------------------------------

alter table private.vercel_installation
  add column if not exists billing_status text not null default 'ok'
    check (billing_status in ('ok', 'overdue')),
  -- Set when Vercel deletes the installation. The token is kept until the
  -- final invoice is in (Vercel allows 24 hours), then the row goes.
  add column if not exists deleted_at timestamptz;

create table if not exists private.vercel_plan_change (
  id bigint generated always as identity primary key,
  installation_id text not null check (installation_id ~ '^icfg_[A-Za-z0-9]{1,64}$'),
  plan_id text not null check (plan_id in ('free', 'pro')),
  effective_at timestamptz not null default timezone('utc', now())
);

create index if not exists vercel_plan_change_installation_idx
  on private.vercel_plan_change (installation_id, effective_at);

alter table private.vercel_plan_change enable row level security;
revoke all privileges on table private.vercel_plan_change from public, anon, authenticated;

-- Existing installations start their history at creation.
insert into private.vercel_plan_change (installation_id, plan_id, effective_at)
select installation.installation_id, installation.billing_plan_id, installation.created_at
from private.vercel_installation as installation
where not exists (
  select 1 from private.vercel_plan_change as change
  where change.installation_id = installation.installation_id
);

create table if not exists private.vercel_invoice (
  installation_id text not null check (installation_id ~ '^icfg_[A-Za-z0-9]{1,64}$'),
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end > period_start),
  external_id text not null unique check (char_length(external_id) between 1 and 120),
  vercel_invoice_id text unique
    check (vercel_invoice_id is null or char_length(vercel_invoice_id) between 1 and 120),
  total numeric(10, 2) not null check (total >= 0),
  final boolean not null default false,
  state text not null default 'pending'
    check (state in (
      'pending', 'failed', 'submitted', 'scheduled', 'invoiced', 'paid', 'notpaid',
      'overdue', 'refund_requested', 'refunded'
    )),
  attempts integer not null default 0 check (attempts between 0 and 1000),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (installation_id, period_start)
);

alter table private.vercel_invoice enable row level security;
revoke all privileges on table private.vercel_invoice from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The workspace's plan follows the installation: Pro only while the plan is
-- Pro, nothing is overdue and the installation is not being deleted.
-- ---------------------------------------------------------------------------

create or replace function private.sync_vercel_organization_plan(target_installation_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.organizations as organization
    set billing_plan = case
          when installation.billing_plan_id = 'pro'
           and installation.billing_status = 'ok'
           and installation.deleted_at is null then 'pro'
          else 'free'
        end,
        billing_source = 'vercel'
    from private.vercel_installation as installation
    where installation.installation_id = target_installation_id
      and organization.id = installation.organization_id;
$$;

create or replace function private.upsert_vercel_installation(
  target_installation_id text,
  target_account_id text,
  target_token_ciphertext text,
  target_account_name text,
  target_contact_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_organization_id uuid;
  created_organization_id uuid;
begin
  select installation.organization_id into existing_organization_id
  from private.vercel_installation as installation
  where installation.installation_id = target_installation_id
  for update;

  if existing_organization_id is not null then
    update private.vercel_installation
      set token_ciphertext = target_token_ciphertext,
          account_name = coalesce(target_account_name, account_name),
          contact_email = coalesce(target_contact_email, contact_email),
          updated_at = timezone('utc', now())
      where installation_id = target_installation_id;
    return existing_organization_id;
  end if;

  insert into public.organizations (name, billing_source)
  values (coalesce(nullif(btrim(target_account_name), ''), 'Vercel team'), 'vercel')
  returning id into created_organization_id;

  insert into private.vercel_installation (
    installation_id, organization_id, account_id, token_ciphertext, account_name, contact_email
  )
  values (
    target_installation_id, created_organization_id, target_account_id,
    target_token_ciphertext, target_account_name, target_contact_email
  );

  insert into private.vercel_plan_change (installation_id, plan_id)
  values (target_installation_id, 'free');

  return created_organization_id;
end;
$$;

-- Logs a change only when the plan actually changes, so a repeated PATCH from
-- Vercel does not split the month.
create or replace function private.set_vercel_installation_plan(
  target_installation_id text,
  target_billing_plan_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_plan text;
begin
  select installation.billing_plan_id into current_plan
  from private.vercel_installation as installation
  where installation.installation_id = target_installation_id
    and installation.deleted_at is null
  for update;

  if current_plan is null then
    return false;
  end if;

  if current_plan <> target_billing_plan_id then
    update private.vercel_installation
      set billing_plan_id = target_billing_plan_id,
          updated_at = timezone('utc', now())
      where installation_id = target_installation_id;
    insert into private.vercel_plan_change (installation_id, plan_id)
    values (target_installation_id, target_billing_plan_id);
  end if;

  perform private.sync_vercel_organization_plan(target_installation_id);
  return true;
end;
$$;

create or replace function private.set_vercel_billing_status(
  target_installation_id text,
  target_status text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.vercel_installation
    set billing_status = target_status,
        updated_at = timezone('utc', now())
    where installation_id = target_installation_id;
  if not found then
    return false;
  end if;
  perform private.sync_vercel_organization_plan(target_installation_id);
  return true;
end;
$$;

drop function if exists public.read_vercel_installation(text);
drop function if exists private.read_vercel_installation(text);

create function private.read_vercel_installation(target_installation_id text)
returns table (
  organization_id uuid,
  account_id text,
  token_ciphertext text,
  billing_plan_id text,
  billing_status text,
  deleted_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select installation.organization_id, installation.account_id,
         installation.token_ciphertext, installation.billing_plan_id,
         installation.billing_status, installation.deleted_at, installation.created_at
  from private.vercel_installation as installation
  where installation.installation_id = target_installation_id;
$$;

-- Every installation the billing run looks at, deleted ones included until
-- their final invoice is in.
create or replace function private.list_vercel_installations_for_billing()
returns table (
  installation_id text,
  token_ciphertext text,
  billing_plan_id text,
  billing_status text,
  deleted_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select installation.installation_id, installation.token_ciphertext,
         installation.billing_plan_id, installation.billing_status,
         installation.deleted_at, installation.created_at
  from private.vercel_installation as installation
  order by installation.created_at
  limit 5000;
$$;

-- The plan in force at `since` plus every change until `until`.
create or replace function private.list_vercel_plan_changes(
  target_installation_id text,
  since timestamptz,
  until timestamptz
)
returns table (plan_id text, effective_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  (
    select change.plan_id, change.effective_at
    from private.vercel_plan_change as change
    where change.installation_id = target_installation_id
      and change.effective_at <= since
    order by change.effective_at desc, change.id desc
    limit 1
  )
  union all
  (
    select change.plan_id, change.effective_at
    from private.vercel_plan_change as change
    where change.installation_id = target_installation_id
      and change.effective_at > since
      and change.effective_at < until
    order by change.effective_at, change.id
  );
$$;

-- Uninstall, step one: the locks and their bypass secrets go at once; the
-- token stays for the final invoice.
create or replace function private.mark_vercel_installation_deleted(target_installation_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_organization_id uuid;
begin
  delete from private.live_lock_bypass as bypass
  using public.live_lock_resource as resource
  where bypass.target_id = resource.target_id
    and resource.installation_id = target_installation_id;

  delete from public.live_lock_project as project
  using public.live_lock_resource as resource
  where project.resource_id = resource.resource_id
    and resource.installation_id = target_installation_id;

  delete from public.live_lock_resource as resource
  where resource.installation_id = target_installation_id;

  update private.vercel_installation
    set deleted_at = coalesce(deleted_at, timezone('utc', now())),
        updated_at = timezone('utc', now())
    where installation_id = target_installation_id
  returning organization_id into removed_organization_id;

  if removed_organization_id is not null then
    perform private.sync_vercel_organization_plan(target_installation_id);
  end if;
  return removed_organization_id;
end;
$$;

-- Records the invoice for a period before it is sent. An existing row is
-- returned as it is, so a retry never invoices a period twice.
create or replace function private.claim_vercel_invoice(
  target_installation_id text,
  target_period_start timestamptz,
  target_period_end timestamptz,
  target_external_id text,
  target_total numeric,
  target_final boolean
)
returns table (state text, vercel_invoice_id text, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.vercel_invoice (
    installation_id, period_start, period_end, external_id, total, final
  )
  values (
    target_installation_id, target_period_start, target_period_end,
    target_external_id, target_total, target_final
  )
  on conflict (installation_id, period_start) do nothing;

  return query
    select invoice.state, invoice.vercel_invoice_id, invoice.attempts
    from private.vercel_invoice as invoice
    where invoice.installation_id = target_installation_id
      and invoice.period_start = target_period_start;
end;
$$;

create or replace function private.record_vercel_invoice_attempt(
  target_installation_id text,
  target_period_start timestamptz,
  target_vercel_invoice_id text,
  target_error text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.vercel_invoice
    set vercel_invoice_id = coalesce(target_vercel_invoice_id, vercel_invoice_id),
        state = case when target_vercel_invoice_id is not null then 'submitted' else 'failed' end,
        attempts = attempts + 1,
        last_error = left(target_error, 500),
        updated_at = timezone('utc', now())
    where installation_id = target_installation_id
      and period_start = target_period_start
      and state in ('pending', 'failed');
$$;

-- Invoice webhooks. Returns the installation, or null for an invoice we did
-- not send.
create or replace function private.set_vercel_invoice_state(
  target_vercel_invoice_id text,
  target_state text
)
returns text
language sql
security definer
set search_path = ''
as $$
  update private.vercel_invoice
    set state = target_state,
        updated_at = timezone('utc', now())
    where vercel_invoice_id = target_vercel_invoice_id
  returning installation_id;
$$;

-- An installation with no unsettled final invoice can be purged after
-- deletion. Returns the open invoice states, empty when none.
create or replace function private.list_open_vercel_invoices(target_installation_id text)
returns table (period_start timestamptz, state text)
language sql
security definer
set search_path = ''
as $$
  select invoice.period_start, invoice.state
  from private.vercel_invoice as invoice
  where invoice.installation_id = target_installation_id
    and invoice.state in ('pending', 'failed');
$$;

-- SSO into an installation that is being deleted is refused.
create or replace function private.join_vercel_installation(
  target_installation_id text,
  target_user_id text,
  target_role text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  installation_organization_id uuid;
begin
  if target_role not in ('admin', 'member') then
    raise exception 'invalid role' using errcode = '22023';
  end if;

  select installation.organization_id into installation_organization_id
  from private.vercel_installation as installation
  where installation.installation_id = target_installation_id
    and installation.deleted_at is null;

  if installation_organization_id is null then
    return null;
  end if;

  insert into public.memberships (user_id, organization_id, role, last_selected_at)
  values (target_user_id, installation_organization_id, target_role, timezone('utc', now()))
  on conflict (user_id, organization_id) do update
    set role = excluded.role,
        last_selected_at = excluded.last_selected_at;

  return installation_organization_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only, through public wrappers.
-- ---------------------------------------------------------------------------

do $$
declare
  signature text;
begin
  foreach signature in array array[
    'sync_vercel_organization_plan(text)',
    'upsert_vercel_installation(text, text, text, text, text)',
    'set_vercel_installation_plan(text, text)',
    'set_vercel_billing_status(text, text)',
    'read_vercel_installation(text)',
    'list_vercel_installations_for_billing()',
    'list_vercel_plan_changes(text, timestamptz, timestamptz)',
    'mark_vercel_installation_deleted(text)',
    'claim_vercel_invoice(text, timestamptz, timestamptz, text, numeric, boolean)',
    'record_vercel_invoice_attempt(text, timestamptz, text, text)',
    'set_vercel_invoice_state(text, text)',
    'list_open_vercel_invoices(text)'
  ]
  loop
    execute format('revoke all on function private.%s from public, anon, authenticated', signature);
    execute format('grant execute on function private.%s to service_role', signature);
  end loop;
end;
$$;

create or replace function public.set_vercel_installation_plan(
  target_installation_id text,
  target_billing_plan_id text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.set_vercel_installation_plan(target_installation_id, target_billing_plan_id);
$$;

create or replace function public.set_vercel_billing_status(
  target_installation_id text,
  target_status text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.set_vercel_billing_status(target_installation_id, target_status);
$$;

create function public.read_vercel_installation(target_installation_id text)
returns table (
  organization_id uuid,
  account_id text,
  token_ciphertext text,
  billing_plan_id text,
  billing_status text,
  deleted_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select * from private.read_vercel_installation(target_installation_id);
$$;

create or replace function public.list_vercel_installations_for_billing()
returns table (
  installation_id text,
  token_ciphertext text,
  billing_plan_id text,
  billing_status text,
  deleted_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select * from private.list_vercel_installations_for_billing();
$$;

create or replace function public.list_vercel_plan_changes(
  target_installation_id text,
  since timestamptz,
  until timestamptz
)
returns table (plan_id text, effective_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select * from private.list_vercel_plan_changes(target_installation_id, since, until);
$$;

create or replace function public.mark_vercel_installation_deleted(target_installation_id text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.mark_vercel_installation_deleted(target_installation_id);
$$;

create or replace function public.claim_vercel_invoice(
  target_installation_id text,
  target_period_start timestamptz,
  target_period_end timestamptz,
  target_external_id text,
  target_total numeric,
  target_final boolean
)
returns table (state text, vercel_invoice_id text, attempts integer)
language sql
security definer
set search_path = ''
as $$
  select * from private.claim_vercel_invoice(
    target_installation_id, target_period_start, target_period_end,
    target_external_id, target_total, target_final
  );
$$;

create or replace function public.record_vercel_invoice_attempt(
  target_installation_id text,
  target_period_start timestamptz,
  target_vercel_invoice_id text,
  target_error text
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.record_vercel_invoice_attempt(
    target_installation_id, target_period_start, target_vercel_invoice_id, target_error
  );
$$;

create or replace function public.set_vercel_invoice_state(
  target_vercel_invoice_id text,
  target_state text
)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.set_vercel_invoice_state(target_vercel_invoice_id, target_state);
$$;

create or replace function public.list_open_vercel_invoices(target_installation_id text)
returns table (period_start timestamptz, state text)
language sql
security definer
set search_path = ''
as $$
  select * from private.list_open_vercel_invoices(target_installation_id);
$$;

do $$
declare
  signature text;
begin
  foreach signature in array array[
    'set_vercel_installation_plan(text, text)',
    'set_vercel_billing_status(text, text)',
    'read_vercel_installation(text)',
    'list_vercel_installations_for_billing()',
    'list_vercel_plan_changes(text, timestamptz, timestamptz)',
    'mark_vercel_installation_deleted(text)',
    'claim_vercel_invoice(text, timestamptz, timestamptz, text, numeric, boolean)',
    'record_vercel_invoice_attempt(text, timestamptz, text, text)',
    'set_vercel_invoice_state(text, text)',
    'list_open_vercel_invoices(text)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', signature);
    execute format('grant execute on function public.%s to service_role', signature);
  end loop;
end;
$$;
