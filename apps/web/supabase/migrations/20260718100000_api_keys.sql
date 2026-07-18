-- API keys: programmatic access to the hosted, shape-only verdict (Phase 7).
-- A key authenticates an ORGANIZATION (not a user) so an agent/OEM caller can
-- read `GET /api/v1/verdict` and the MCP `assurly_verdict` tool can read the
-- hosted API on the org's behalf. The keyed path is READ-ONLY over existing
-- verdicts and never triggers an active probe (the ownership gate stays the
-- single authority — see utils/ownership/gate.ts + utils/programmaticVerdict.ts).
--
-- Security model:
--   * The PLAINTEXT key is never stored. We store only a sha256 hash of a
--     high-entropy (192-bit) random key; the plaintext is shown to the creator
--     exactly once, on creation, and cannot be recovered afterwards.
--   * `key_prefix` is a short, non-secret display fragment for the dashboard
--     (so a user can tell keys apart) — it is not sufficient to authenticate.
--   * Revocation is a soft flag (`revoked_at`) so the audit trail and last-used
--     telemetry survive; a revoked key fails auth exactly like a missing one.
--   * The request-time auth lookup (by `key_hash`, with no user session) runs via
--     the service role, which bypasses RLS. Org members manage their own keys via
--     the RLS policies below; the app never SELECTs `key_hash` for a client.
--
-- Phase 7 of the genius rebuild (docs/roadmap/10-genius-rebuild-master-plan.md).
-- Additive + idempotent (create table/index/policy guarded) per convention §3.2.

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- Human label so a user can tell their keys apart in the dashboard.
  label text not null check (char_length(label) between 1 and 120),

  -- Short, non-secret display fragment (e.g. "ask_live_ab12cd"). NOT enough to
  -- authenticate — the full plaintext (only ever shown once) is required.
  key_prefix text not null check (key_prefix ~ '^ask_live_[A-Za-z0-9_-]{2,16}$'),

  -- sha256 hex of the full plaintext key. The plaintext is never persisted.
  key_hash text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),

  -- Plan gates the rate limit (see RATE_LIMITS + apiKeyRateLimitForPlan). Snapshotted
  -- at creation from the org's billing_plan; re-issue a key to change tiers.
  plan text not null default 'free' check (plan in ('free', 'pro')),

  last_used_at timestamptz,
  -- Soft revocation: a revoked key fails auth like a missing one, but the row
  -- (and its telemetry) is retained for the audit trail.
  revoked_at timestamptz,

  created_at timestamptz not null default timezone('utc', now())
);

alter table public.api_keys enable row level security;

create index if not exists api_keys_organization_id_idx on public.api_keys (organization_id);
-- key_hash lookups use the unique constraint's implicit index.

-- RLS: organization members may read and maintain their org's keys. Mirrors the
-- tenant model used by targets/fix_outcome (private.is_organization_member). The
-- request-time auth lookup uses the service role and bypasses these policies.
drop policy if exists select_api_key_member on public.api_keys;
create policy select_api_key_member on public.api_keys
  for select to authenticated
  using (private.is_organization_member(organization_id));

drop policy if exists insert_api_key_member on public.api_keys;
create policy insert_api_key_member on public.api_keys
  for insert to authenticated
  with check (private.is_organization_member(organization_id));

drop policy if exists update_api_key_member on public.api_keys;
create policy update_api_key_member on public.api_keys
  for update to authenticated
  using (private.is_organization_member(organization_id))
  with check (private.is_organization_member(organization_id));

grant select, insert, update on table public.api_keys to authenticated;
