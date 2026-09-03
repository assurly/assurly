-- The branch a repository actually ships from.
--
-- Only the default branch owns a repository's shipping verdict: a feature
-- branch or a pull-request head is not what ships. Scans persisted before that
-- rule existed record no default, so ownership fell back to guessing
-- main/master — wrong for any repository that ships from `src`, `develop`, or
-- anything else. This column is the real answer when we know it.
--
-- Nullable on purpose: NULL means "not learned yet", which is different from
-- any branch name. Rows fall back to the guess until a scan reports the real
-- default, which then applies retroactively to that repository's older scans.

alter table public.repositories
  add column if not exists default_branch text
    check (default_branch is null or char_length(default_branch) between 1 and 255);

comment on column public.repositories.default_branch is
  'GitHub default branch, learned at scan time. NULL = unknown; only scans on this branch own the repo verdict.';
