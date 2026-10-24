-- One rule id per check, in every channel.
--
-- The CLI up to 1.2.x reported three scanner-core checks under its wrapper
-- rule's id, `supabase-security-checks`, and reworded the missing-RLS message.
-- The dashboard stores the same findings as `supabase-rls`,
-- `supabase-service-role-leak` and `public-secret`, and everything keyed by
-- rule id (consequence copy, the AI fix prompt, live confirmation, "no longer
-- found since") only knows those. New uploads are mapped on write
-- (canonicalizeLegacyFinding in @assurly/scanner-core); this maps the rows
-- already stored, matching on scanner-core's own messages exactly as the
-- code does. Rows it cannot place keep their id.

update public.scan_findings
set
  rule_id = 'supabase-rls',
  message = replace(message, 'is created in migration files, but', 'is created but')
where rule_id = 'supabase-security-checks'
  and message like '%Row-Level Security (RLS) is not enabled%';

update public.scan_findings
set rule_id = 'supabase-service-role-leak'
where rule_id = 'supabase-security-checks'
  and message like 'Potential service_role key leakage%';

update public.scan_findings
set rule_id = 'public-secret'
where rule_id = 'supabase-security-checks'
  and message like '%exposes a server secret to the browser.';
