-- Learn the public site a repository ships to, from GitHub's `homepage`.
--
-- 1B binds a repository to a verified `url` target only when this origin equals
-- the target identifier. The column is nullable: NULL means "not learned yet"
-- (or GitHub cleared it), which is different from any origin — there is no
-- binding, silently.
--
-- repositories uses COLUMN-scoped UPDATE grants (see 20260810054119 /
-- 20260903120000). Adding a written column without its grant is a silent 42501
-- under the `authenticated` role, so the grant ships in this same file. The
-- existing policy `update_repository_scan_capability_member` (plain FOR UPDATE)
-- already covers every column; no new policy.

alter table public.repositories
  add column if not exists homepage_url text
  check (homepage_url is null or char_length(homepage_url) between 8 and 2048);

grant update (homepage_url)
on table public.repositories
to authenticated;

notify pgrst, 'reload schema';
