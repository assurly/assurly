-- Per-target alert preferences for the Continuous Guardian (Phase 6).
-- Email remains the default delivery path (org admin emails via Resend);
-- Slack/Discord incoming webhooks are optional channels stored here.
-- Additive / idempotent — safe to re-run. Org-scoped RLS mirrors `targets`.

create table if not exists public.target_alert_prefs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  target_id uuid not null references public.targets (id) on delete cascade,

  -- Delivery channel. `email` toggles the Resend path; `slack` / `discord`
  -- require a verified incoming-webhook URL.
  channel text not null check (channel in ('email', 'slack', 'discord')),
  webhook_url text,
  enabled boolean not null default true,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  unique (target_id, channel)
);

alter table public.target_alert_prefs enable row level security;

create index if not exists target_alert_prefs_organization_id_idx
  on public.target_alert_prefs (organization_id);
create index if not exists target_alert_prefs_target_id_idx
  on public.target_alert_prefs (target_id);

drop policy if exists select_target_alert_prefs_member on public.target_alert_prefs;
create policy select_target_alert_prefs_member on public.target_alert_prefs
  for select to authenticated
  using (private.is_organization_member(organization_id));

drop policy if exists insert_target_alert_prefs_member on public.target_alert_prefs;
create policy insert_target_alert_prefs_member on public.target_alert_prefs
  for insert to authenticated
  with check (private.is_organization_member(organization_id));

drop policy if exists update_target_alert_prefs_member on public.target_alert_prefs;
create policy update_target_alert_prefs_member on public.target_alert_prefs
  for update to authenticated
  using (private.is_organization_member(organization_id))
  with check (private.is_organization_member(organization_id));

drop policy if exists delete_target_alert_prefs_member on public.target_alert_prefs;
create policy delete_target_alert_prefs_member on public.target_alert_prefs
  for delete to authenticated
  using (private.is_organization_member(organization_id));

grant select, insert, update, delete on table public.target_alert_prefs to authenticated;
