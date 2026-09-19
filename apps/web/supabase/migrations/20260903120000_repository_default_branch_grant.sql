-- Let authenticated members record the branch a repository ships from.
--
-- 20260902090000 added repositories.default_branch, and persistRepoScan writes
-- it from the default GitHub reports at scan time. That write runs as the
-- `authenticated` role and was refused in production:
--
--   42501 permission denied for table repositories
--
-- Adding the column does not grant privileges on it, so the learning step
-- failed on every scan (best-effort, logged as repo-default-branch-write-failed,
-- so scans still succeeded — the branch was simply never recorded).
--
-- Column-level UPDATE only, mirroring 20260810054119 for scan_capability: no
-- blanket table UPDATE. Row access is already gated by the existing
-- `update_repository_scan_capability_member` policy, which is a plain FOR UPDATE
-- policy on this table rather than a column-specific one, so it covers this
-- column too and no second policy is added here. (Its name is narrower than what
-- it does; renaming it is out of scope for this fix.)

grant update (default_branch)
on table public.repositories
to authenticated;

-- Ensure PostgREST sees the new column privileges promptly.
notify pgrst, 'reload schema';
