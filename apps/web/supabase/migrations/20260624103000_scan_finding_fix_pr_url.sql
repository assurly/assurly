-- Persist GitHub pull-request links for auto-fix findings.

alter table public.scan_findings
  add column if not exists fix_pr_url text;

alter table public.scan_findings
  drop constraint if exists scan_findings_fix_pr_url_check;

alter table public.scan_findings
  add constraint scan_findings_fix_pr_url_check
  check (fix_pr_url is null or fix_pr_url ~ '^https://github\.com/');

grant update (fix_pr_url)
on table public.scan_findings
to authenticated;

drop policy if exists update_finding_fix_pr_member on public.scan_findings;

create policy update_finding_fix_pr_member on public.scan_findings
  for update
  using (
    scan_id in (
      select s.id
      from public.scans s
      join public.repositories r on s.repository_id = r.id
      join public.memberships m on r.organization_id = m.organization_id
      where m.user_id = auth.uid()::text
    )
  )
  with check (
    fix_pr_url is null or fix_pr_url ~ '^https://github\.com/'
  );
