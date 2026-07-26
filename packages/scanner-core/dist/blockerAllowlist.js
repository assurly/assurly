"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HIGH_CONFIDENCE_BLOCKER_RULE_IDS = void 0;
exports.isHighConfidenceBlockerRuleId = isHighConfidenceBlockerRuleId;
/**
 * High-confidence blocker ruleIds (error + confidence high, or legacy error
 * without confidence).
 *
 * The Phase 0 target was "~12 or fewer". Phase 3 added five genuinely
 * high-precision blockers to the existing nine, landing at 14. Every entry here
 * must be near-certain when it fires; heuristic rules stay review/warning only.
 * Notably, the two auth-boundary "no visible guard" rules
 * (auth-server-action-no-check, auth-route-handler-unprotected) are error+medium
 * → review, NOT blockers, because public forms and public routes legitimately
 * run without auth — so they are deliberately absent from this list.
 *
 * Agent-stack rule ids (`agent-*`) must NEVER appear here. Those findings may
 * be error+high for triage priority, but they audit the developer's tooling
 * environment — not the app under ship — and blocking on them would destroy
 * trust on the first scan. See `agentStack.ts` and `shipGate.ts`.
 *
 *  1. stripe-webhook-signature
 *  2. database-migration-safety
 *  3. supabase-rls
 *  4. supabase-service-role-leak
 *  5. public-secret
 *  6. stripe-secret-leak
 *  7. undocumented-env
 *  8. ai-llm-key-in-client
 *  9. database-connection-pooling (CLI)
 * 10. auth-service-role-bypass
 * 11. supabase-policy-permissive
 * 12. supabase-migration-auth-linked-no-rls
 * 13. stripe-live-key-in-dev
 * 14. vercel-edge-node-mismatch
 */
exports.HIGH_CONFIDENCE_BLOCKER_RULE_IDS = [
    'stripe-webhook-signature',
    'database-migration-safety',
    'supabase-rls',
    'supabase-service-role-leak',
    'public-secret',
    'stripe-secret-leak',
    'undocumented-env',
    'ai-llm-key-in-client',
    'database-connection-pooling',
    'auth-service-role-bypass',
    'supabase-policy-permissive',
    'supabase-migration-auth-linked-no-rls',
    'stripe-live-key-in-dev',
    'vercel-edge-node-mismatch',
];
const BLOCKER_ID_SET = new Set(exports.HIGH_CONFIDENCE_BLOCKER_RULE_IDS);
/** True when `ruleId` is on the ship-gate blocker allowlist. */
function isHighConfidenceBlockerRuleId(ruleId) {
    if (!ruleId)
        return false;
    return BLOCKER_ID_SET.has(ruleId);
}
