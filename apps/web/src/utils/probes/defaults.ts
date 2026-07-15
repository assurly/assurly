/**
 * Deterministic Layer-1 fallback table list. Used when the AI planner is
 * unavailable (no key / budget / parse failure). The AI path may add tables
 * beyond this list; this list alone must still produce a reproducible gate.
 */
export const DEFAULT_SENSITIVE_SUPABASE_TABLES = [
  'profiles',
  'users',
  'posts',
  'orders',
  'customers',
  'subscriptions',
  'messages',
  'accounts',
  'payments',
] as const;

export type DefaultSensitiveTable = (typeof DEFAULT_SENSITIVE_SUPABASE_TABLES)[number];

/** Hard caps — independent of the LLM. */
export const PROBE_MAX_STEPS = 12;
export const PROBE_MAX_DURATION_MS = 30_000;
