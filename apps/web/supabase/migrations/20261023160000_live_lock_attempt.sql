-- Live Lock: one row per deploy-path check. The row records the verdict of a
-- fresh read-only re-probe. It stores no row contents and no samples — those
-- stay in probe_evidence, already redacted.
--
-- A repeated attempt_id for the same target is the same check (CI retry). The
-- unique key makes that replay a read, not a second probe.

create table if not exists public.live_lock_attempt (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  target_id uuid not null references public.targets (id) on delete cascade,
  git_sha text not null
    check (git_sha ~ '^[0-9a-f]{7,64}$'),
  attempt_id text not null
    check (attempt_id ~ '^[A-Za-z0-9_.:-]{1,120}$'),
  status text not null
    check (status in ('ready', 'blocked')),
  ship_score integer not null
    check (ship_score between 0 and 100),
  reason text not null
    check (reason in ('ownership_unverified', 'probe_refused', 'runtime_blocker', 'clear')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (target_id, attempt_id)
);

alter table public.live_lock_attempt enable row level security;

create index if not exists live_lock_attempt_target_created_idx
  on public.live_lock_attempt (target_id, created_at desc);

create index if not exists live_lock_attempt_organization_id_idx
  on public.live_lock_attempt (organization_id);

drop policy if exists select_live_lock_attempt_member on public.live_lock_attempt;
create policy select_live_lock_attempt_member on public.live_lock_attempt
  for select to authenticated
  using (private.is_organization_member(organization_id));

grant select on table public.live_lock_attempt to authenticated;
