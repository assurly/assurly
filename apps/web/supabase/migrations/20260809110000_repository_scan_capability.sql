-- Browser-scan capability for repository cards (Unscanned hygiene).
-- browser = eligible for in-browser GitHub scan
-- cli_only = too large / tree limits; use `npx assurly scan`
-- invalid = stored name is not owner/repo (needs attention / remove)

alter table public.repositories
  add column if not exists scan_capability text
    not null default 'browser'
    check (scan_capability in ('browser', 'cli_only', 'invalid'));

comment on column public.repositories.scan_capability is
  'Whether the dashboard can scan this repo in-browser: browser | cli_only | invalid.';
