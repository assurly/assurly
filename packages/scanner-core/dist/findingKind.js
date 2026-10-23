"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDatabaseSafetyNetAdvisory = isDatabaseSafetyNetAdvisory;
exports.isCiWorkflowSuggestion = isCiWorkflowSuggestion;
exports.isRlsWithoutPolicyAdvisory = isRlsWithoutPolicyAdvisory;
exports.findingKind = findingKind;
exports.isIssueFinding = isIssueFinding;
const COVERAGE_RULE_IDS = new Set([
    'scan-completeness',
    'scan-language-coverage',
    'dep-registry-unavailable',
    'dep-scan-capped',
]);
const SETUP_RULE_IDS = new Set([
    'github-actions-integration',
    'assurly-canary-missing',
]);
const INFO_RULE_IDS = new Set(['assurly-canary-planted']);
/**
 * `supabase-rls` on a stack with no Supabase signal: the scanner labels the
 * table "Database table" instead of "Supabase table". Without Supabase or
 * PostgREST no browser holds a key to the database, so missing RLS is a
 * missing safety net, not a leak — and the stock fix (`ENABLE ROW LEVEL
 * SECURITY` with no policy) either does nothing for the owner role or blocks
 * every query the app makes.
 */
function isDatabaseSafetyNetAdvisory(finding) {
    return finding.ruleId === 'supabase-rls' && /^Database table '/.test(finding.message ?? '');
}
/**
 * The CI-workflow nag, including copies persisted before the rename to Assurly
 * under rule `general` that still tell people to run `npx shipready init` —
 * a package on npm that is not ours.
 */
function isCiWorkflowSuggestion(finding) {
    if (finding.ruleId === 'github-actions-integration')
        return true;
    return /github actions workflow for (assurly|shipready) is missing/i.test(finding.message ?? '');
}
/** RLS on with no policy: right for server-only tables, so never scored. */
function isRlsWithoutPolicyAdvisory(finding) {
    return finding.ruleId === 'supabase-rls-no-policy';
}
function findingKind(finding) {
    const ruleId = finding.ruleId ?? '';
    if (INFO_RULE_IDS.has(ruleId))
        return 'info';
    if (SETUP_RULE_IDS.has(ruleId) || isCiWorkflowSuggestion(finding))
        return 'setup';
    if (COVERAGE_RULE_IDS.has(ruleId))
        return 'coverage';
    if (isDatabaseSafetyNetAdvisory(finding) || isRlsWithoutPolicyAdvisory(finding)) {
        return 'advisory';
    }
    return 'issue';
}
function isIssueFinding(finding) {
    return findingKind(finding) === 'issue';
}
