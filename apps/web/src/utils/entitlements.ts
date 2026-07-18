/**
 * Plan entitlements — the single source of truth for what each billing plan is
 * allowed to do (Phase 8). Pure and I/O-free so it can be unit-tested in
 * isolation and reused by any server route without pulling in the DB layer.
 *
 * Enforcement lives in the routes (server-side, via `secureRoute`): this module
 * only MAPS a plan to its limits. A client that reads these values is a UX hint,
 * never the gate — the route must re-derive and enforce them.
 *
 * Keep the plan enum in sync across three places (Phase 8 convention):
 *   1. the DB checks (`organizations.billing_plan`, `api_keys.plan`),
 *   2. `apiKeyRateLimitForPlan` in utils/apiSecurity.ts,
 *   3. this module.
 * The exhaustive `switch` below fails to compile if a new plan is added without
 * a mapping, which forces (2) and the DB migration to be updated alongside it.
 */

/**
 * The billing plans an organization can be on.
 *
 * - `free`  — the viral proof-probe + a single guarded app.
 * - `pro`   — per-app: continuous guardian + AI deep review + verified badge.
 * - `oem`   — B2B2C platform tier for the keyed verdict API (usage/seat).
 *
 * NOTE: Stripe only ever moves an org between `free` and `pro` (see
 * `planForStatus` in utils/stripeBilling.ts). `oem` is provisioned by the owner
 * out of band — it is never set from a Stripe webhook.
 */
export type BillingPlan = 'free' | 'pro' | 'oem';

/** The API-key rate tier snapshotted onto a key at issuance. */
export type ApiKeyTier = BillingPlan;

export interface Entitlements {
  /**
   * How many apps (targets) the org may guard. `null` = unlimited. A re-scan of
   * an already-guarded app is always allowed; only creating a NEW target beyond
   * this count is rejected.
   */
  guardedAppLimit: number | null;
  /** The rate tier a newly issued API key inherits (see apiKeyRateLimitForPlan). */
  apiKeyTier: ApiKeyTier;
  /** Whether Layer 2 AI deep review may run for this org (paid feature). */
  deepReviewEnabled: boolean;
  /** Whether the org is an OEM/platform tenant (white-label keyed API surface). */
  oem: boolean;
}

/**
 * Maps a billing plan to its entitlements. Total over `BillingPlan` — adding a
 * plan without a case here is a compile error (the `never` default), which is the
 * mechanism that keeps the enum in sync with the rest of the codebase.
 */
export function entitlementsForPlan(plan: BillingPlan): Entitlements {
  switch (plan) {
    case 'free':
      return { guardedAppLimit: 1, apiKeyTier: 'free', deepReviewEnabled: false, oem: false };
    case 'pro':
      return { guardedAppLimit: null, apiKeyTier: 'pro', deepReviewEnabled: true, oem: false };
    case 'oem':
      return { guardedAppLimit: null, apiKeyTier: 'oem', deepReviewEnabled: true, oem: true };
    default: {
      const exhaustive: never = plan;
      throw new Error(`Unknown billing plan: ${String(exhaustive)}`);
    }
  }
}
