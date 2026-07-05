import { Rule } from '../types';
/**
 * Phase 3 deeper-stack rules: auth boundaries, Supabase policy quality, Stripe
 * lifecycle, and Vercel maxDuration. Edge-runtime detection is intentionally
 * excluded here because `vercelRules` already runs it — see the
 * `includeEdgeRuntime` option on `runDeeperStackScans`.
 *
 * Each scanner carries its own severity + confidence, which the Ship Gate uses
 * to route findings (error+high → blocker, error+medium / warning → review), so
 * the granular ruleIds are preserved rather than remapped to this wrapper id.
 */
export declare const deeperStackRules: Rule;
