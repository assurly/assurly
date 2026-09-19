import type { WebFinding } from '../browserScanner';
import { readLimitedResponseText } from '../githubApp';
import { PROBE_MAX_RESPONSE_BYTES } from './defaults';
import { pickRedactedSampleCell } from './redact';
import type { ProbeExecutionContext, ProbeStepEvidence, ProbeStepResult } from './types';

export const API_ENDPOINT_OPEN_RULE_ID = 'runtime-api-endpoint-open';

/**
 * Location string for an open-endpoint finding. As with `supabaseTableLocation`,
 * the path is part of the finding's IDENTITY: regression detection keys on
 * `rule_id | file_path | line_number`, so a second exposed endpoint must not
 * collapse onto the first one's key. Origin + path is stable and distinct —
 * record counts live in evidence, never here.
 */
export function appEndpointLocation(targetOrigin: string, path: string): string {
  return `${targetOrigin} · GET ${path}`;
}

/** Keys whose mere presence means the payload is personal data, not a catalogue. */
const PII_KEY_PARTS = new Set(['email', 'phone', 'password', 'token', 'secret', 'ssn', 'card']);
const EMAIL_SHAPED = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;
const MAX_PII_SCAN_DEPTH = 6;

function nothing(): ProbeStepResult {
  return { findings: [], evidence: [] };
}

function isPiiKey(key: string): boolean {
  return key
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((part) => PII_KEY_PARTS.has(part));
}

function containsPii(value: unknown, depth = 0): boolean {
  if (depth > MAX_PII_SCAN_DEPTH) return false;
  if (typeof value === 'string') return EMAIL_SHAPED.test(value.trim());
  if (Array.isArray(value)) return value.some((entry) => containsPii(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, entry]) => isPiiKey(key) || containsPii(entry, depth + 1),
    );
  }
  return false;
}

/**
 * Normalises a JSON payload to the records it exposes. A non-empty array is its
 * entries; a non-empty object is a single record. Anything else (`[]`, `{}`,
 * `null`, a primitive) proves nothing and is not a finding.
 */
function toRecords(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload.length > 0 ? payload : null;
  if (payload && typeof payload === 'object') {
    return Object.keys(payload as Record<string, unknown>).length > 0 ? [payload] : null;
  }
  return null;
}

/**
 * Whitelisted primitive: one unauthenticated same-origin GET of an `/api/…`
 * path on the owned target. No credentials, no cookies, no query string, no
 * headers beyond `Accept` — the point is to prove what a stranger sees.
 *
 * Only `params.path` is planner-chosen (zod-validated); the origin comes from
 * `ctx`. Fetches go through `ctx.safeFetch` (the SSRF-safe path injected by the
 * scanner), and a `UrlSafetyError` from it aborts the whole plan.
 *
 * Silence is a correct answer: a 401/403 means the lock works, a 3xx means we
 * were sent to a login, a 404/405 or an HTML body means it is not an API, and a
 * 5xx is a bug in the app — never a reportable exposure.
 */
export async function executeAppEndpointUnauthenticatedRead(
  params: { path: string },
  ctx: ProbeExecutionContext,
): Promise<ProbeStepResult> {
  const { targetOrigin, fetchImpl, lookupImpl, safeFetch } = ctx;

  let probeUrl: URL;
  let origin: string;
  try {
    origin = new URL(targetOrigin).origin;
    probeUrl = new URL(params.path, origin);
  } catch {
    return nothing();
  }
  // Defence in depth behind the schema: a path must never leave the owned origin
  // or smuggle a query string.
  if (probeUrl.origin !== origin) return nothing();
  if (probeUrl.search || probeUrl.hash) return nothing();

  const { response, finalUrl } = await safeFetch(
    probeUrl.toString(),
    { method: 'GET', headers: { Accept: 'application/json' } },
    fetchImpl,
    lookupImpl,
  );

  // safeFetch follows redirects, so the body may have come from elsewhere.
  if (finalUrl.origin !== origin) return nothing();
  if (response.status !== 200 && response.status !== 206) return nothing();

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('application/json')) return nothing();

  let payload: unknown;
  try {
    payload = JSON.parse(await readLimitedResponseText(response, PROBE_MAX_RESPONSE_BYTES));
  } catch {
    return nothing();
  }

  const records = toRecords(payload);
  if (!records) return nothing();

  const path = params.path;
  const severity: WebFinding['severity'] = containsPii(payload) ? 'error' : 'warning';
  const findings: WebFinding[] = [
    {
      ruleId: API_ENDPOINT_OPEN_RULE_ID,
      severity,
      message:
        severity === 'error'
          ? `API endpoint '${path}' returned personal data to a request with no session.`
          : `API endpoint '${path}' returned data to a request with no session.`,
      suggestion: `Require an authenticated session on '${path}' and return 401 when it is missing.`,
      file: appEndpointLocation(origin, path),
    },
  ];

  const firstRecord =
    records[0] && typeof records[0] === 'object' && !Array.isArray(records[0])
      ? (records[0] as Record<string, unknown>)
      : {};
  const sampleCell = pickRedactedSampleCell(firstRecord);

  const evidence: ProbeStepEvidence[] = [
    {
      findingRuleId: API_ENDPOINT_OPEN_RULE_ID,
      kind: 'open_endpoint',
      summary: `GET ${path} answered with ${records.length} record(s) without a session.`,
      redactedSample: {
        rowCount: records.length,
        columns: Object.keys(firstRecord),
        ...(sampleCell ? { sampleCell } : {}),
      },
    },
  ];

  return { findings, evidence };
}
