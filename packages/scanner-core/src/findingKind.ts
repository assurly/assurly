import type { ScannerFinding } from './index';

/**
 * What a finding is about. Only `issue` describes a problem in the user's app,
 * so only issues are listed as findings, count toward the Ship Score, or go
 * into a fix prompt. The rest still reach the user, each in its own place:
 *
 * - `coverage`: something this scan could not check (unread code, a registry
 *   lookup that failed). It limits how much the verdict proves.
 * - `setup`: an optional Assurly setup step (CI workflow, silent alarm).
 * - `info`: a state worth showing that needs no action (a planted canary).
 * - `advisory`: worth knowing, not a problem today (a database without
 *   row-level security that no browser can reach). Shown, never scored.
 *
 * Production data showed why this matters: in 14 of 16 repositories the latest
 * scan's findings were about Assurly itself, so no app could ever reach Ready.
 */
export type FindingKind = 'issue' | 'coverage' | 'setup' | 'info' | 'advisory';

const COVERAGE_RULE_IDS: ReadonlySet<string> = new Set([
  'scan-completeness',
  'scan-language-coverage',
  'dep-registry-unavailable',
  'dep-scan-capped',
]);

const SETUP_RULE_IDS: ReadonlySet<string> = new Set([
  'github-actions-integration',
  'assurly-canary-missing',
]);

const INFO_RULE_IDS: ReadonlySet<string> = new Set(['assurly-canary-planted']);

/**
 * `supabase-rls` on a stack with no Supabase signal: the scanner labels the
 * table "Database table" instead of "Supabase table". Without Supabase or
 * PostgREST no browser holds a key to the database, so missing RLS is a
 * missing safety net, not a leak — and the stock fix (`ENABLE ROW LEVEL
 * SECURITY` with no policy) either does nothing for the owner role or blocks
 * every query the app makes.
 */
export function isDatabaseSafetyNetAdvisory(
  finding: Pick<ScannerFinding, 'ruleId' | 'message'>,
): boolean {
  return finding.ruleId === 'supabase-rls' && /^Database table '/.test(finding.message ?? '');
}

/**
 * The CI-workflow nag, including copies persisted before the rename to Assurly
 * under rule `general` that still tell people to run `npx shipready init` —
 * a package on npm that is not ours.
 */
export function isCiWorkflowSuggestion(
  finding: Pick<ScannerFinding, 'ruleId' | 'message'>,
): boolean {
  if (finding.ruleId === 'github-actions-integration') return true;
  return /github actions workflow for (assurly|shipready) is missing/i.test(finding.message ?? '');
}

export function findingKind(finding: Pick<ScannerFinding, 'ruleId' | 'message'>): FindingKind {
  const ruleId = finding.ruleId ?? '';
  if (INFO_RULE_IDS.has(ruleId)) return 'info';
  if (SETUP_RULE_IDS.has(ruleId) || isCiWorkflowSuggestion(finding)) return 'setup';
  if (COVERAGE_RULE_IDS.has(ruleId)) return 'coverage';
  if (isDatabaseSafetyNetAdvisory(finding)) return 'advisory';
  return 'issue';
}

export function isIssueFinding(finding: Pick<ScannerFinding, 'ruleId' | 'message'>): boolean {
  return findingKind(finding) === 'issue';
}
