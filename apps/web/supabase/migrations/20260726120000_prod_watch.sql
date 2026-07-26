-- Prod Watch (D5c): optional abuse-sequence monitoring over customer Supabase
-- logs. Privacy model:
--   * Raw log lines are NEVER stored.
--   * IP addresses are NEVER stored (in any form).
--   * Only derived query-shape counts + coarse verdicts persist.
--   * Opt-in per target, off by default; disable purges derived rows + credential.
--   * Short retention is enforced in application code
--     (PROD_WATCH_SIGNAL_RETENTION_MS) and by deleting rows older than 7 days.
-- Additive + idempotent. Org-scoped RLS mirrors `targets`.

-- Opt-in subscription + encrypted Management API credential (read-only).
create table if not exists public.prod_watch_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  target_id uuid not null references public.targets (id) on delete cascade,

  -- Off by default. Explicit enable required; never inferred from ownership/scan.
  enabled boolean not null default false,

  -- Supabase project ref the customer authorised (not a free-form URL).
  supabase_project_ref text not null
    check (supabase_project_ref ~ '^[a-z0-9]{10,32}$'),

  -- AES-256-GCM ciphertext of the customer-supplied Management API token.
  -- Plaintext is never logged. Format: base64(iv || tag || ciphertext).
  access_token_ciphertext text not null
    check (char_length(access_token_ciphertext) between 32 and 8192),

  last_checked_at timestamptz,
  last_status text not null default 'never'
    check (last_status in ('never', 'clear', 'abuse_sequence', 'not_checked', 'error')),
  last_error text,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  unique (target_id)
);

alter table public.prod_watch_subscriptions enable row level security;

create index if not exists prod_watch_subscriptions_organization_id_idx
  on public.prod_watch_subscriptions (organization_id);
create index if not exists prod_watch_subscriptions_enabled_idx
  on public.prod_watch_subscriptions (enabled)
  where enabled = true;

-- Derived signals only — shape counts per time bucket. No raw lines, no IPs.
create table if not exists public.prod_watch_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  target_id uuid not null references public.targets (id) on delete cascade,

  bucket_start timestamptz not null,
  -- { "schema_introspection": n, "table_enumeration": n, "bulk_read": n, "other": n }
  shape_counts jsonb not null default '{}'::jsonb,
  -- Distinct table path segments observed in this bucket (identifiers, not PII).
  distinct_tables integer not null default 0 check (distinct_tables >= 0),
  verdict text not null
    check (verdict in ('clear', 'abuse_sequence', 'not_checked')),

  created_at timestamptz not null default timezone('utc', now())
);

alter table public.prod_watch_signals enable row level security;

create index if not exists prod_watch_signals_target_bucket_idx
  on public.prod_watch_signals (target_id, bucket_start desc);
create index if not exists prod_watch_signals_created_at_idx
  on public.prod_watch_signals (created_at);

-- Open-incident rows collapse repeat alerts for the same ongoing sequence.
create table if not exists public.prod_watch_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  target_id uuid not null references public.targets (id) on delete cascade,
  rule_id text not null check (rule_id ~ '^prod-[a-z0-9-]+$'),
  status text not null default 'open' check (status in ('open', 'closed')),
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  last_alerted_at timestamptz,
  alert_count integer not null default 0 check (alert_count >= 0)
);

alter table public.prod_watch_incidents enable row level security;

create index if not exists prod_watch_incidents_target_status_idx
  on public.prod_watch_incidents (target_id, status);

-- At most one open incident per (target, rule). Closed rows are historical.
create unique index if not exists prod_watch_incidents_one_open_idx
  on public.prod_watch_incidents (target_id, rule_id)
  where status = 'open';

-- RLS: org members may read/manage their subscriptions and read derived rows.
-- Credential ciphertext is readable to members (they supplied it); cron uses
-- service role. Inserts into signals/incidents are service-role only.

drop policy if exists select_prod_watch_subscriptions_member on public.prod_watch_subscriptions;
create policy select_prod_watch_subscriptions_member on public.prod_watch_subscriptions
  for select to authenticated
  using (private.is_organization_member(organization_id));

drop policy if exists insert_prod_watch_subscriptions_member on public.prod_watch_subscriptions;
create policy insert_prod_watch_subscriptions_member on public.prod_watch_subscriptions
  for insert to authenticated
  with check (private.is_organization_member(organization_id));

drop policy if exists update_prod_watch_subscriptions_member on public.prod_watch_subscriptions;
create policy update_prod_watch_subscriptions_member on public.prod_watch_subscriptions
  for update to authenticated
  using (private.is_organization_member(organization_id))
  with check (private.is_organization_member(organization_id));

drop policy if exists delete_prod_watch_subscriptions_member on public.prod_watch_subscriptions;
create policy delete_prod_watch_subscriptions_member on public.prod_watch_subscriptions
  for delete to authenticated
  using (private.is_organization_member(organization_id));

drop policy if exists select_prod_watch_signals_member on public.prod_watch_signals;
create policy select_prod_watch_signals_member on public.prod_watch_signals
  for select to authenticated
  using (private.is_organization_member(organization_id));

-- Members may delete derived rows on revoke; inserts remain service-role only.
drop policy if exists delete_prod_watch_signals_member on public.prod_watch_signals;
create policy delete_prod_watch_signals_member on public.prod_watch_signals
  for delete to authenticated
  using (private.is_organization_member(organization_id));

drop policy if exists select_prod_watch_incidents_member on public.prod_watch_incidents;
create policy select_prod_watch_incidents_member on public.prod_watch_incidents
  for select to authenticated
  using (private.is_organization_member(organization_id));

drop policy if exists delete_prod_watch_incidents_member on public.prod_watch_incidents;
create policy delete_prod_watch_incidents_member on public.prod_watch_incidents
  for delete to authenticated
  using (private.is_organization_member(organization_id));

grant select, insert, update, delete on table public.prod_watch_subscriptions to authenticated;
grant select, delete on table public.prod_watch_signals to authenticated;
grant select, delete on table public.prod_watch_incidents to authenticated;

revoke insert, update on table public.prod_watch_signals from authenticated, anon;
revoke insert, update on table public.prod_watch_incidents from authenticated, anon;
