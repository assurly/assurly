-- Allow an org member to attach a share token to a scan they can access.
--
-- POST /api/scans/share generates a random token, writes it onto the scan row,
-- and returns a public /report/<token> URL. That write is an UPDATE on
-- public.scans -- but the table only ever had SELECT/INSERT policies (plus the
-- DELETE one from 20260719000000), and `authenticated` held no UPDATE grant at
-- all. Postgres therefore rejected the PATCH, and because the route's fallback
-- only matched a MISSING COLUMN it fell through to a bare 500: "Share report"
-- never worked in any environment.
--
-- The grant is COLUMN-SCOPED to share_token on purpose. A client must never be
-- able to rewrite commit_sha, status or the finding counts -- those are the
-- evidence a Ship Gate verdict rests on, and a shareable report is only
-- trustworthy if its subject is immutable from the browser. Mirrors the
-- existing `grant update (fix_pr_url)` precedent (20260624103000).
--
-- The policy reuses `private.can_access_repository(repository_id)`, the same
-- predicate as the scan select/insert/delete policies. `with check` repeats it
-- so a row can never be updated INTO a repository the caller cannot access.
--
-- Additive and idempotent so it is safe to re-run.

drop policy if exists update_scan_share_token_member on public.scans;

create policy update_scan_share_token_member on public.scans
for update to authenticated
using (private.can_access_repository(repository_id))
with check (private.can_access_repository(repository_id));

grant update (share_token) on table public.scans to authenticated;
