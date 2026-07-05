-- Persist finding confidence so the Ship Gate can be reconstructed accurately
-- from stored findings. Without it, every error-severity finding was treated as
-- a blocker on reconstruction (effectiveConfidence defaults to 'high'), so
-- review-level findings (error + medium/low, e.g. rsc-data-leak) wrongly counted
-- as blockers in the public badge score and regression alerts.
--
-- Nullable on purpose: existing rows keep NULL, which the scanner-core Ship Gate
-- already interprets as 'high' (legacy behavior), so historical scans are
-- unchanged. New scans persist the real confidence.

alter table public.scan_findings
  add column if not exists confidence text;

alter table public.scan_findings
  drop constraint if exists scan_findings_confidence_check;

alter table public.scan_findings
  add constraint scan_findings_confidence_check
  check (confidence is null or confidence in ('high', 'medium', 'low'));
