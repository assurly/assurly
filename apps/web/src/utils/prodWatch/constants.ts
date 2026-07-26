/**
 * Prod Watch (D5c) constants.
 *
 * Privacy posture: raw customer log lines and IP addresses are never persisted.
 * Only derived query-shape counts and coarse verdicts are stored, and only for
 * a short window. See docs/legal/DRAFT-prod-watch-privacy-terms-trust.md.
 */

/**
 * How long derived signals / closed-incident metadata are kept.
 *
 * Rationale: the abuse signature is a short sequence (minutes). Keeping a week
 * of shape counts is enough to show recent alerts in the dashboard and to
 * collapse an ongoing incident, without building a long-lived traffic archive
 * that would invite DSR / retention obligations disproportionate to the feature.
 */
export const PROD_WATCH_SIGNAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Lookback window fetched from the Management API per check. */
export const PROD_WATCH_FETCH_LOOKBACK_MS = 60 * 60 * 1000;

/** Sequence must complete inside this window to count as one incident. */
export const PROD_WATCH_SEQUENCE_WINDOW_MS = 15 * 60 * 1000;

/** Minimum distinct /rest/v1/{table} paths after schema introspection. */
export const PROD_WATCH_MIN_ENUMERATED_TABLES = 3;

/**
 * After an alert fires, further detections of the same open incident do not
 * re-alert until this cooldown elapses (alert collapsing).
 */
export const PROD_WATCH_ALERT_COLLAPSE_MS = 6 * 60 * 60 * 1000;

/** Soft wall-clock budget for one cron invocation (under Vercel maxDuration). */
export const PROD_WATCH_MAX_WALL_MS = 50_000;

export const PROD_WATCH_MAX_CONCURRENCY = 2;

/** Per-target fetch timeout. */
export const PROD_WATCH_FETCH_TIMEOUT_MS = 12_000;

/**
 * Hardcoded Supabase Management API hosts. Never take a log-fetch URL from
 * customer-controlled data — only the project ref is customer-supplied.
 */
export const SUPABASE_MANAGEMENT_API_HOSTS = ['api.supabase.com'] as const;

export const SUPABASE_MANAGEMENT_API_ORIGIN = 'https://api.supabase.com';

/** Finding rule id — prod-* prefix; review-level only (never a ship blocker). */
export const PROD_WATCH_ABUSE_RULE_ID = 'prod-supabase-anon-abuse-sequence';

/**
 * Master feature flag. Off unless explicitly set to "1".
 * Legal gate: keep off in production until Privacy/Terms drafts are signed off
 * (see docs/legal/DRAFT-prod-watch-privacy-terms-trust.md).
 */
export function isProdWatchFeatureEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.ASSURLY_PROD_WATCH_ENABLED === '1';
}
