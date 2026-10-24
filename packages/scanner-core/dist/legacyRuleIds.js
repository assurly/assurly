"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalizeLegacyFinding = canonicalizeLegacyFinding;
/**
 * The CLI up to 1.2.x reported three scanner-core checks under its wrapper
 * rule's id, `supabase-security-checks`, and reworded the missing-RLS message.
 * Nothing keyed by rule id (consequence copy, the AI fix prompt, live
 * confirmation) recognised them. Current releases keep scanner-core's ids;
 * this maps a finding from an older CLI back, so uploads from pinned versions
 * read the same as everything else. Matched on scanner-core's own messages.
 */
const LEGACY_SUPABASE_WRAPPER_ID = 'supabase-security-checks';
const LEGACY_RLS_WORDING = 'is created in migration files, but';
function legacyRuleId(message) {
    if (message.includes('Row-Level Security (RLS) is not enabled'))
        return 'supabase-rls';
    if (message.startsWith('Potential service_role key leakage'))
        return 'supabase-service-role-leak';
    if (message.endsWith('exposes a server secret to the browser.'))
        return 'public-secret';
    return null;
}
function canonicalizeLegacyFinding(finding) {
    if (finding.ruleId !== LEGACY_SUPABASE_WRAPPER_ID)
        return finding;
    const ruleId = legacyRuleId(finding.message);
    if (!ruleId)
        return finding;
    return {
        ...finding,
        ruleId,
        message: finding.message.replace(LEGACY_RLS_WORDING, 'is created but'),
    };
}
