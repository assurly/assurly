-- Targets: the persistent "current verdict" per monitored app (a connected repo
-- or a verified live URL). Scans remain the event and source of truth; a target
-- is the current-state projection updated on each scan, plus the metadata scans
-- do not carry: which AI builder produced the app, ownership proof, and the
-- shareable badge token.
--
-- This is the core object of the genius rebuild (see
-- docs/roadmap/10-genius-rebuild-master-plan.md, Phase 1). Ownership columns are
-- created now but only enforced from Phase 3; verdict columns are written from
-- Phase 1 onward.

create table if not exists public.targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- Identity. `kind` distinguishes a connected repo from a live URL; the
  -- (organization_id, kind, identifier) triple is unique so re-scanning updates
  -- the same target instead of creating duplicates.
  kind text not null check (kind in ('repo', 'url')),
  identifier text not null,
  display_name text,
  -- For `repo` targets, the owning repositories row (kept in sync, cascade-deleted).
  repository_id uuid references public.repositories (id) on delete cascade,

  -- Provenance: which AI builder produced the app (Phase 0 detector output).
  generator_fingerprint text
    check (generator_fingerprint in ('lovable', 'v0', 'bolt', 'cursor', 'replit', 'unknown')),

  -- Ownership proof (enforced from Phase 3 for active URL probing).
  ownership_verified boolean not null default false,
  ownership_method text
    check (ownership_method in ('github_app', 'dns_txt', 'meta_tag', 'file', 'deploy_link')),

  -- Denormalised current verdict, refreshed on every scan.
  current_verdict text check (current_verdict in ('ready', 'review', 'blocked', 'unknown')),
  current_ship_score integer check (current_ship_score between 0 and 100),
  -- Compact evidence for one-glance display (top issue + counts); see resolveVerdict.
  verdict_evidence jsonb,
  last_checked_at timestamptz,

  -- Public badge/trust token (unified across repo + url targets).
  badge_token text,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  unique (organization_id, kind, identifier)
);

alter table public.targets enable row level security;

create index if not exists targets_organization_id_idx on public.targets (organization_id);
create index if not exists targets_repository_id_idx on public.targets (repository_id);
create unique index if not exists targets_badge_token_uidx
  on public.targets (badge_token)
  where badge_token is not null;

-- RLS: organization members may read and maintain their org's targets. Mirrors
-- the tenant model used by repositories/scans (private.is_organization_member).
drop policy if exists select_target_member on public.targets;
create policy select_target_member on public.targets
  for select to authenticated
  using (private.is_organization_member(organization_id));

drop policy if exists insert_target_member on public.targets;
create policy insert_target_member on public.targets
  for insert to authenticated
  with check (private.is_organization_member(organization_id));

drop policy if exists update_target_member on public.targets;
create policy update_target_member on public.targets
  for update to authenticated
  using (private.is_organization_member(organization_id))
  with check (private.is_organization_member(organization_id));

grant select, insert, update on table public.targets to authenticated;
