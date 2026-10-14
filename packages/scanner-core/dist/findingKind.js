"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCiWorkflowSuggestion = isCiWorkflowSuggestion;
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
 * The CI-workflow nag, including copies persisted before the rename to Assurly
 * under rule `general` that still tell people to run `npx shipready init` —
 * a package on npm that is not ours.
 */
function isCiWorkflowSuggestion(finding) {
    if (finding.ruleId === 'github-actions-integration')
        return true;
    return /github actions workflow for (assurly|shipready) is missing/i.test(finding.message ?? '');
}
function findingKind(finding) {
    const ruleId = finding.ruleId ?? '';
    if (INFO_RULE_IDS.has(ruleId))
        return 'info';
    if (SETUP_RULE_IDS.has(ruleId) || isCiWorkflowSuggestion(finding))
        return 'setup';
    if (COVERAGE_RULE_IDS.has(ruleId))
        return 'coverage';
    return 'issue';
}
function isIssueFinding(finding) {
    return findingKind(finding) === 'issue';
}
