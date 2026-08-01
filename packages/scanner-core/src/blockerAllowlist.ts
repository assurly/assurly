/**
 * High-confidence blocker ruleIds (error + confidence high, or legacy error
 * without confidence).
 *
 * The Phase 0 target was "~12 or fewer". Deeper-stack work landed at 14; the
 * dependency-provenance guard adds three near-certain blockers (16 total after
 * demoting undocumented-env to warning). Every entry here must be near-certain
 * when it fires; heuristic rules stay review/warning only. Notably, the two
 * auth-boundary "no visible guard" rules (auth-server-action-no-check,
 * auth-route-handler-unprotected) are error+medium → review, NOT blockers,
 * because public forms and public routes legitimately run without auth — so
 * they are deliberately absent from this list. Missing `.env.example` docs
 * (`undocumented-env`) are warning-only hygiene — not ship blockers.
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
 *  7. ai-llm-key-in-client
 *  8. database-connection-pooling (CLI)
 *  9. auth-service-role-bypass
 * 10. supabase-policy-permissive
 * 11. supabase-migration-auth-linked-no-rls
 * 12. stripe-live-key-in-dev
 * 13. vercel-edge-node-mismatch
 * 14. dep-nonexistent-package
 * 15. dep-typosquat-suspect
 * 16. dep-slopsquat-suspect
 */
export const HIGH_CONFIDENCE_BLOCKER_RULE_IDS = [
  'stripe-webhook-signature',
  'database-migration-safety',
  'supabase-rls',
  'supabase-service-role-leak',
  'public-secret',
  'stripe-secret-leak',
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
