import { assertScannableUrl, UrlSafetyError } from '../urlSafety';
import {
  PROD_WATCH_FETCH_LOOKBACK_MS,
  PROD_WATCH_FETCH_TIMEOUT_MS,
  SUPABASE_MANAGEMENT_API_HOSTS,
  SUPABASE_MANAGEMENT_API_ORIGIN,
} from './constants';
import { requestSignalFromLogRow } from './derive';
import type { RawRequestSignal } from './shapes';

export type ProdWatchFetchResult =
  | { ok: true; requests: RawRequestSignal[] }
  | { ok: false; reason: 'unreachable' | 'unauthorized' | 'invalid_response' | 'unsafe_url' };

/**
 * ClickHouse SQL that returns ONLY method/path/status/timestamp.
 * Deliberately omits IP, UA, headers, and event_message so even the ephemeral
 * payload stays narrow. Filtered to edge_logs (PostgREST / REST API).
 */
export const PROD_WATCH_LOGS_SQL = [
  'SELECT',
  '  timestamp,',
  "  log_attributes['request.method'] AS method,",
  "  log_attributes['request.path'] AS path,",
  "  log_attributes['response.status_code'] AS status_code",
  'FROM logs',
  "WHERE source = 'edge_logs'",
  "  AND log_attributes['request.path'] LIKE '/rest/v1%'",
  'ORDER BY timestamp DESC',
  'LIMIT 500',
].join('\n');

/**
 * Build the Management API URL for a project ref. Host is hardcoded; only the
 * path segment is interpolated from a validated ref.
 */
export function buildProdWatchLogsUrl(
  projectRef: string,
  nowMs: number = Date.now(),
  lookbackMs: number = PROD_WATCH_FETCH_LOOKBACK_MS,
): string {
  const start = new Date(nowMs - lookbackMs).toISOString();
  const end = new Date(nowMs).toISOString();
  const url = new URL(
    `${SUPABASE_MANAGEMENT_API_ORIGIN}/v1/projects/${encodeURIComponent(projectRef)}/analytics/endpoints/logs`,
  );
  url.searchParams.set('iso_timestamp_start', start);
  url.searchParams.set('iso_timestamp_end', end);
  url.searchParams.set('sql', PROD_WATCH_LOGS_SQL);
  return url.toString();
}

/** Reject any URL that is not on the hardcoded Management API host allowlist. */
export function assertSupabaseManagementApiUrl(rawUrl: string): URL {
  const url = assertScannableUrl(rawUrl);
  if (url.protocol !== 'https:') {
    throw new UrlSafetyError('Prod Watch requires HTTPS to the Management API.');
  }
  if (
    !(SUPABASE_MANAGEMENT_API_HOSTS as readonly string[]).includes(url.hostname.toLowerCase())
  ) {
    throw new UrlSafetyError('Prod Watch refuses a non-allowlisted Management API host.');
  }
  if (!url.pathname.startsWith('/v1/projects/')) {
    throw new UrlSafetyError('Prod Watch Management API path is out of scope.');
  }
  return url;
}

/**
 * Fetch recent edge log metadata (read-only). Degrades to unreachable on
 * network/timeout/5xx — callers must not fail the whole cron batch.
 */
export async function fetchProdWatchRequestSignals(options: {
  projectRef: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  timeoutMs?: number;
}): Promise<ProdWatchFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let url: URL;
  try {
    url = assertSupabaseManagementApiUrl(buildProdWatchLogsUrl(options.projectRef, options.nowMs));
  } catch {
    return { ok: false, reason: 'unsafe_url' };
  }

  const timeoutMs = options.timeoutMs ?? PROD_WATCH_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
      redirect: 'error',
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: 'unauthorized' };
    }
    if (!response.ok) {
      return { ok: false, reason: 'unreachable' };
    }

    const body: unknown = await response.json();
    const rows = extractLogRows(body);
    if (rows === null) return { ok: false, reason: 'invalid_response' };

    const requests: RawRequestSignal[] = [];
    for (const row of rows) {
      const signal = requestSignalFromLogRow(row);
      if (signal) requests.push(signal);
    }
    return { ok: true, requests };
  } catch {
    return { ok: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

function extractLogRows(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (Array.isArray(record.result)) return record.result;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.results)) return record.results;
  return null;
}
