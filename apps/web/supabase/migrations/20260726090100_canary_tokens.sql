-- Canary tokens: intentional tripwire credentials an owner plants in a
-- plausible place. Any inbound hit on the public callback means someone found
-- the token where they should not have been.
--
-- Security model (mirrors api_keys):
--   * The PLAINTEXT token is never stored. We store only a sha256 hash.
--   * The plaintext is shown to the creator exactly once on creation.
--   * Distinctive prefix `ask_canary_` so Assurly's own secret scanners classify
--     a planted canary as informational, never as a leak.
--   * The public callback looks up by hash under the service role (bypasses RLS).
--   * Org members manage their canaries via the RLS policies below.
--   * Hit telemetry stores a truncated/hashed source signal — never a raw IP
--     (Trust page PII discipline).
--
-- Additive + idempotent per migration convention.

create table if not exists public.canary_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Ownership-verified target this canary protects (url or repo).
  target_id uuid not null references public.targets (id) on delete cascade,

  -- Short, non-secret display fragment (e.g. "ask_canary_ab12cd").
  token_prefix text not null check (token_prefix ~ '^ask_canary_[A-Za-z0-9_-]{2,16}$'),

  -- sha256 hex of the full plaintext. The plaintext is never persisted.
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),

  label text not null default 'Canary' check (char_length(label) between 1 and 120),

  last_hit_at timestamptz,
  hit_count integer not null default 0 check (hit_count >= 0),
  -- Soft revocation so the audit trail survives.
  revoked_at timestamptz,

  created_at timestamptz not null default timezone('utc', now())
);

alter table public.canary_tokens enable row level security;

create index if not exists canary_tokens_organization_id_idx
  on public.canary_tokens (organization_id);
create index if not exists canary_tokens_target_id_idx
  on public.canary_tokens (target_id);

-- Hit log: coarse source info for the alert. No raw IP.
create table if not exists public.canary_token_hits (
  id uuid primary key default gen_random_uuid(),
  canary_token_id uuid not null references public.canary_tokens (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  target_id uuid not null references public.targets (id) on delete cascade,
  -- Truncated / hashed source signal (e.g. first 3 octets of IPv4 hashed).
  source_hash text not null check (char_length(source_hash) between 8 and 128),
  user_agent_hash text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.canary_token_hits enable row level security;

create index if not exists canary_token_hits_canary_token_id_idx
  on public.canary_token_hits (canary_token_id);
create index if not exists canary_token_hits_organization_id_idx
  on public.canary_token_hits (organization_id);

-- RLS: org members may read/manage their canaries. Callback uses service role.
drop policy if exists select_canary_token_member on public.canary_tokens;
create policy select_canary_token_member on public.canary_tokens
  for select to authenticated
  using (private.is_organization_member(organization_id));

drop policy if exists insert_canary_token_member on public.canary_tokens;
create policy insert_canary_token_member on public.canary_tokens
  for insert to authenticated
  with check (private.is_organization_member(organization_id));

drop policy if exists update_canary_token_member on public.canary_tokens;
create policy update_canary_token_member on public.canary_tokens
  for update to authenticated
  using (private.is_organization_member(organization_id))
  with check (private.is_organization_member(organization_id));

drop policy if exists select_canary_token_hit_member on public.canary_token_hits;
create policy select_canary_token_hit_member on public.canary_token_hits
  for select to authenticated
  using (private.is_organization_member(organization_id));

grant select, insert, update on table public.canary_tokens to authenticated;
grant select on table public.canary_token_hits to authenticated;
-- Inserts into hits are service-role only (callback path).
revoke insert, update, delete on table public.canary_token_hits from authenticated, anon;
