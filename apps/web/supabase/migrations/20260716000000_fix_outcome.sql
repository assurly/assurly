-- Fix outcomes: the verified-fix loop record and the seed of the proprietary
-- corpus. Each row captures one finding's runtime state after a re-probe:
-- verified_fixed (was open, gone after deploy), still_open (open baseline / still
-- open), or regressed (was closed, open again). This is the "we solved it" proof
-- the subscription is sold on, and the aggregate over
-- (generator_fingerprint, finding_rule_id, fix_strategy, outcome) is the moat.
--
-- Phase 5 of the genius rebuild (see docs/roadmap/10-genius-rebuild-master-plan.md).
-- PATTERNS ONLY here at the aggregate layer — never customer data (convention §2.8).
-- Redaction of any proof stays inside the scanner; this table stores no rows/PII.

create table if not exists public.fix_outcome (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- The guarded app this outcome belongs to. Resolved from our own DB, never from
  -- a webhook payload (see api/vercel/webhook).
  target_id uuid references public.targets (id) on delete cascade,
  -- The scan this outcome relates to, when one exists (nullable: runtime URL
  -- re-probes are not persisted as a scan row).
  scan_id uuid references public.scans (id) on delete set null,
  -- The join key back to the finding this outcome addresses (the scanner rule id).
  finding_rule_id text not null,
  -- Provenance for the corpus rollup (which AI builder produced the app).
  generator_fingerprint text,
  -- How the fix was applied (e.g. an Assurly auto-fix PR strategy), when known.
  fix_strategy text,
  outcome text not null
    check (outcome in ('verified_fixed', 'still_open', 'regressed')),
  pr_url text,
  -- Idempotency key for deploy-triggered re-probes: a deploy webhook can fire more
  -- than once per deploy, so the same (target, rule, deploy) must never duplicate.
  -- Nullable for on-demand re-probes, which are user-initiated and need no dedupe.
  deploy_id text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.fix_outcome enable row level security;

create index if not exists fix_outcome_organization_id_idx
  on public.fix_outcome (organization_id);
create index if not exists fix_outcome_target_rule_idx
  on public.fix_outcome (target_id, finding_rule_id);
-- One outcome per (target, rule, deploy) so a re-fired deploy webhook is a no-op.
create unique index if not exists fix_outcome_target_rule_deploy_uidx
  on public.fix_outcome (target_id, finding_rule_id, deploy_id)
  where deploy_id is not null;

-- RLS: organization members may read and write their org's fix outcomes.
-- Mirrors the tenant model used by targets/probe_evidence (private.is_organization_member).
drop policy if exists select_fix_outcome_member on public.fix_outcome;
create policy select_fix_outcome_member on public.fix_outcome
  for select to authenticated
  using (private.is_organization_member(organization_id));

drop policy if exists insert_fix_outcome_member on public.fix_outcome;
create policy insert_fix_outcome_member on public.fix_outcome
  for insert to authenticated
  with check (private.is_organization_member(organization_id));

drop policy if exists update_fix_outcome_member on public.fix_outcome;
create policy update_fix_outcome_member on public.fix_outcome
  for update to authenticated
  using (private.is_organization_member(organization_id))
  with check (private.is_organization_member(organization_id));

grant select, insert, update on table public.fix_outcome to authenticated;

-- ---------------------------------------------------------------------------
-- Vercel deploy webhook idempotency.
--
-- Mirrors the GitHub delivery idempotency model (private.github_webhook_deliveries).
-- The webhook is unauthenticated by definition, so the delivery is claimed FIRST
-- (before any re-probe); a duplicate delivery of the same deploy is a no-op and
-- never triggers a second probe or a duplicate fix_outcome row.
-- ---------------------------------------------------------------------------

create table if not exists private.vercel_webhook_deliveries (
  -- The Vercel deployment id (dpl_...). One row per deploy we act on.
  deploy_id text primary key
    check (deploy_id ~ '^[A-Za-z0-9_-]{1,120}$'),
  event_type text not null
    check (event_type ~ '^[a-z._-]{1,80}$'),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  target_id uuid not null references public.targets (id) on delete cascade,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  attempts smallint not null default 1 check (attempts between 1 and 3),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists vercel_webhook_deliveries_organization_id_idx
  on private.vercel_webhook_deliveries (organization_id);
create index if not exists vercel_webhook_deliveries_target_id_idx
  on private.vercel_webhook_deliveries (target_id);

alter table private.vercel_webhook_deliveries enable row level security;
revoke all privileges on table private.vercel_webhook_deliveries
  from public, anon, authenticated;

create or replace function private.claim_vercel_webhook_delivery(
  target_deploy_id text,
  target_event_type text,
  target_organization_id uuid,
  target_target_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean;
begin
  if target_deploy_id is null
    or target_deploy_id !~ '^[A-Za-z0-9_-]{1,120}$'
    or target_event_type is null
    or target_event_type !~ '^[a-z._-]{1,80}$'
    or target_organization_id is null
    or target_target_id is null then
    raise exception 'invalid Vercel delivery' using errcode = '22023';
  end if;

  insert into private.vercel_webhook_deliveries (
    deploy_id,
    event_type,
    organization_id,
    target_id
  ) values (
    target_deploy_id,
    target_event_type,
    target_organization_id,
    target_target_id
  )
  on conflict (deploy_id) do nothing
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

create or replace function private.finish_vercel_webhook_delivery(
  target_deploy_id text,
  succeeded boolean,
  failure_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.vercel_webhook_deliveries
  set status = case when succeeded then 'completed' else 'failed' end,
      error_message = case
        when succeeded then null
        else left(coalesce(failure_message, 'Unknown background processing failure'), 1000)
      end,
      processed_at = now()
  where deploy_id = target_deploy_id
    and status = 'processing';

  if not found then
    raise exception 'Vercel delivery is not processing' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.claim_vercel_webhook_delivery(
  target_deploy_id text,
  target_event_type text,
  target_organization_id uuid,
  target_target_id uuid
)
returns boolean language sql volatile security invoker set search_path = ''
as $$
  select private.claim_vercel_webhook_delivery(
    target_deploy_id, target_event_type, target_organization_id, target_target_id
  );
$$;

create or replace function public.finish_vercel_webhook_delivery(
  target_deploy_id text,
  succeeded boolean,
  failure_message text default null
)
returns void language sql volatile security invoker set search_path = ''
as $$
  select private.finish_vercel_webhook_delivery(
    target_deploy_id, succeeded, failure_message
  );
$$;

revoke all on function private.claim_vercel_webhook_delivery(text, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.finish_vercel_webhook_delivery(text, boolean, text)
  from public, anon, authenticated;
revoke all on function public.claim_vercel_webhook_delivery(text, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.finish_vercel_webhook_delivery(text, boolean, text)
  from public, anon, authenticated;

grant execute on function private.claim_vercel_webhook_delivery(text, text, uuid, uuid)
  to service_role;
grant execute on function private.finish_vercel_webhook_delivery(text, boolean, text)
  to service_role;
grant execute on function public.claim_vercel_webhook_delivery(text, text, uuid, uuid)
  to service_role;
grant execute on function public.finish_vercel_webhook_delivery(text, boolean, text)
  to service_role;
