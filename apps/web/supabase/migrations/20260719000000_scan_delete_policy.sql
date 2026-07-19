-- Allow an org member to delete a single scan they can access.
--
-- Scans remain the source of truth for the dashboard, but a repo accumulates
-- re-scans of the same commit with no way to prune them. This adds a scoped
-- DELETE policy so an authenticated member can remove one scan at a time,
-- reusing the same `private.can_access_repository(repository_id)` predicate as
-- the existing scan select/insert policies (20260620151511_tenant_authorization).
--
-- Child rows are already cleaned up by their foreign keys — no manual deletes:
--   * public.scan_findings.scan_id  -> on delete cascade (20260614000000)
--   * public.probe_evidence.scan_id -> on delete cascade (20260714000000)
--   * public.fix_outcome.scan_id    -> on delete set null (20260716000000)
--
-- Additive and idempotent so it is safe to re-run.

drop policy if exists delete_scan_member on public.scans;

create policy delete_scan_member on public.scans
for delete to authenticated
using (private.can_access_repository(repository_id));

grant delete on table public.scans to authenticated;
