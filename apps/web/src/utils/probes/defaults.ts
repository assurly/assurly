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

/**
 * Deterministic Layer-1 fallback API paths — the routes an AI-built SaaS almost
 * always generates, ordered most-sensitive first. Same contract as the table
 * list above: discovered (`/api/…` literal) paths are probed first, then this
 * list fills the remaining budget.
 */
export const DEFAULT_SENSITIVE_API_PATHS = [
  '/api/users',
  '/api/me',
  '/api/admin',
  '/api/export',
  '/api/customers',
  '/api/orders',
  '/api/keys',
  '/api/settings',
] as const;

export type DefaultSensitiveApiPath = (typeof DEFAULT_SENSITIVE_API_PATHS)[number];

/** Hard caps — independent of the LLM. */
export const PROBE_MAX_STEPS = 12;
export const PROBE_MAX_DURATION_MS = 30_000;
/** Cap on discovered API paths kept from one bundle, before the step budget applies. */
export const PROBE_MAX_DISCOVERED_PATHS = 20;
/**
 * Byte ceiling for a probe response body. Must stay equal to
 * `RUNTIME_MAX_RESPONSE_BYTES`; duplicated here so `probes/` never imports
 * runtimeScanner (which imports this module). `defaults.test.ts` locks the two
 * together.
 */
export const PROBE_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
