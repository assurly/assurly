/**
 * High-confidence blocker ruleIds (error + confidence high, or legacy error
 * without confidence).
 *
 * The Phase 0 target was "~12 or fewer". Deeper-stack work landed at 14; the
 * dependency-provenance guard adds three near-certain blockers (17 total).
 * Every entry here must be near-certain when it fires; heuristic rules stay
 * review/warning only. Notably, the two auth-boundary "no visible guard" rules
 * (auth-server-action-no-check, auth-route-handler-unprotected) are error+medium
 * → review, NOT blockers, because public forms and public routes legitimately
 * run without auth — so they are deliberately absent from this list.
 *
 * Agent-stack rule ids (`agent-*`) must NEVER appear here. Those findings may
 * be error+high for triage priority, but they audit the developer's tooling
 * environment — not the app under ship — and blocking on them would destroy
 * trust on the first scan. See `agentStack.ts` and `shipGate.ts`.
 *
 * Install-time trust rule ids (`supply-*`) must NEVER appear here either.
 * They are warning-only by product decision (npm 12 is new; blocking week-one
 * migrations uninstalls the gate). See `supplyChain.ts` and `shipGate.ts`.
 *
 * Dependency provenance blockers require near-certainty:
 *   - dep-nonexistent-package: registry 404 (cannot install → blocking is free)
 *   - dep-typosquat-suspect: young AND low downloads AND edit distance ≤ 2
 *   - dep-slopsquat-suspect: borrows a corpus name AND abandoned shape
 *     (1 version, no repository) AND low downloads — age is NOT a factor
 * Warnings (dep-new-unvetted, dep-registry-unavailable) stay off this list.
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
 * 15. dep-nonexistent-package
 * 16. dep-typosquat-suspect
 * 17. dep-slopsquat-suspect
 */
export const HIGH_CONFIDENCE_BLOCKER_RULE_IDS = [
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
  'dep-nonexistent-package',
  'dep-typosquat-suspect',
  'dep-slopsquat-suspect',
] as const;

export type HighConfidenceBlockerRuleId = (typeof HIGH_CONFIDENCE_BLOCKER_RULE_IDS)[number];

const BLOCKER_ID_SET: ReadonlySet<string> = new Set(HIGH_CONFIDENCE_BLOCKER_RULE_IDS);

/** True when `ruleId` is on the ship-gate blocker allowlist. */
export function isHighConfidenceBlockerRuleId(ruleId: string | undefined): boolean {
  if (!ruleId) return false;
  return BLOCKER_ID_SET.has(ruleId);
}
