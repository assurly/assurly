-- Link probe evidence to the url target it was collected against, and allow
-- members to replace a target's current proof (delete + insert).
--
-- Evidence rows for a url target always describe its LATEST probe run. A clean
-- run therefore clears the old proof — a table that was fixed must stop
-- confirming static findings. Transition history already lives in fix_outcome.
--
-- probe_evidence grants are TABLE-level (select, insert, update), so target_id
-- needs no column grant. Contrast repositories, which uses column-scoped UPDATE
-- grants and therefore required `grant update (homepage_url)` in
-- 20260921100000_repository_homepage_url.sql.

alter table public.probe_evidence
  add column if not exists target_id uuid references public.targets (id) on delete cascade;

create index if not exists probe_evidence_target_id_idx
  on public.probe_evidence (target_id);

drop policy if exists delete_probe_evidence_member on public.probe_evidence;
create policy delete_probe_evidence_member on public.probe_evidence
  for delete to authenticated
  using (private.is_organization_member(organization_id));

grant delete on table public.probe_evidence to authenticated;

notify pgrst, 'reload schema';
