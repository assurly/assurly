-- Persist Ship Gate source of truth on each scan so trend, cards, and the
-- detail panel never recompute scores with different file-count assumptions.

alter table public.scans
  add column if not exists ship_score integer
    check (ship_score is null or ship_score between 0 and 100),
  add column if not exists verdict text
    check (verdict is null or verdict in ('ready', 'review', 'blocked', 'failed')),
  add column if not exists scanned_file_count integer
    check (scanned_file_count is null or scanned_file_count >= 0),
  add column if not exists clean_file_count integer
    check (clean_file_count is null or clean_file_count >= 0),
  add column if not exists scan_scope jsonb,
  add column if not exists failure_reason text;

comment on column public.scans.ship_score is
  'Ship Gate score computed at scan time; trend and cards should prefer this over recomputation.';
comment on column public.scans.verdict is
  'Ship Gate status at scan time: ready | review | blocked | failed.';
comment on column public.scans.scanned_file_count is
  'Number of eligible files actually analyzed (may be 0).';
comment on column public.scans.clean_file_count is
  'Files with no findings at scan time.';
comment on column public.scans.scan_scope is
  'Optional coverage summary (roots, scanned, skippedTests) for Ship Gate copy.';
comment on column public.scans.failure_reason is
  'Machine reason when status/verdict is failed (too_large, invalid_repository, no_eligible_files, …).';
