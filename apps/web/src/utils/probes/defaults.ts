/**
 * Deterministic Layer-1 fallback table list — the common sensitive tables in
 * AI-built SaaS apps, ordered most-sensitive first. Used when the AI planner is
 * unavailable (no key / budget / parse failure). It is a CURATED baseline, not
 * exhaustive: the AI path infers app-specific tables from the page beyond this
 * list. This list alone must still produce a reproducible gate.
 *
 * Ordering matters — the deterministic plan probes heuristic (`.from(...)`)
 * tables first, then fills up to `PROBE_MAX_STEPS` from the top of this list.
 */
export const DEFAULT_SENSITIVE_SUPABASE_TABLES = [
  'users',
  'profiles',
  'accounts',
  'customers',
  'contacts',
  'leads',
  'orders',
  'payments',
  'invoices',
  'transactions',
  'subscriptions',
  'api_keys',
  'sessions',
  'tokens',
  'messages',
  'files',
  'documents',
  'notifications',
] as const;

export type DefaultSensitiveTable = (typeof DEFAULT_SENSITIVE_SUPABASE_TABLES)[number];

/** Hard caps — independent of the LLM. */
export const PROBE_MAX_STEPS = 12;
export const PROBE_MAX_DURATION_MS = 30_000;
