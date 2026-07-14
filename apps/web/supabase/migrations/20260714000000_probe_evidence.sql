-- Probe evidence: the redacted proof artifacts behind a runtime finding — e.g.
-- "we retrieved 500 rows from `users`", the open table name, a masked secret
-- prefix, or a missing header. This is what lets the product show real proof
-- ("here is what we actually retrieved") instead of a warning.
--
-- Phase 2 of the genius rebuild (see docs/roadmap/10-genius-rebuild-master-plan.md).
-- Only ever store SHAPE + MASKED samples here — never raw PII (convention §2.8).
-- Redaction happens inside the scanner before a row is ever written.

create table if not exists public.probe_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- The scan this evidence belongs to. Nullable so anonymous/URL previews that
  -- are not persisted as a scan can still be modeled if needed later.
  scan_id uuid references public.scans (id) on delete cascade,
  finding_rule_id text not null,
  kind text not null
    check (kind in ('rls_rows', 'exposed_secret', 'open_endpoint', 'missing_header')),
  -- One-line, human summary, e.g. "Retrieved 500 rows from `users`".
  summary text not null,
  -- Shape + masked sample ONLY (row count, column names, a masked sample cell,
  -- the open table name, a masked secret prefix). Never full personal data.
  redacted_sample jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.probe_evidence enable row level security;

create index if not exists probe_evidence_organization_id_idx
  on public.probe_evidence (organization_id);
create index if not exists probe_evidence_scan_id_idx
  on public.probe_evidence (scan_id);

-- RLS: organization members may read and write their org's probe evidence.
-- Mirrors the tenant model used by targets/scans (private.is_organization_member).
drop policy if exists select_probe_evidence_member on public.probe_evidence;
create policy select_probe_evidence_member on public.probe_evidence
  for select to authenticated
  using (private.is_organization_member(organization_id));

drop policy if exists insert_probe_evidence_member on public.probe_evidence;
create policy insert_probe_evidence_member on public.probe_evidence
  for insert to authenticated
  with check (private.is_organization_member(organization_id));

drop policy if exists update_probe_evidence_member on public.probe_evidence;
create policy update_probe_evidence_member on public.probe_evidence
  for update to authenticated
  using (private.is_organization_member(organization_id))
  with check (private.is_organization_member(organization_id));

grant select, insert, update on table public.probe_evidence to authenticated;
