import { lookup } from 'node:dns/promises';
import { Agent } from 'undici';
import type { WebFinding } from './browserScanner';
import { readLimitedResponseText } from './githubApp';
import { assertPublicIpAddress, assertScannableUrl } from './urlSafety';

export const RUNTIME_FETCH_TIMEOUT_MS = 8_000;
export const RUNTIME_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const RUNTIME_MAX_REDIRECTS = 5;

const MUTATING_HTTP_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

interface LookupRecord {
  address: string;
  family: number;
}

/** Injectable so tests can fake DNS resolution without real network access. */
export type LookupImpl = (hostname: string) => Promise<LookupRecord[]>;

const defaultLookup: LookupImpl = (hostname) => lookup(hostname, { all: true });

interface ResolvedSafeHost {
  address: string;
  family: 4 | 6;
}

type FetchInit = RequestInit & { dispatcher?: Agent };

const SENSITIVE_SUPABASE_TABLES = [
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

const SECRET_PATTERNS: Array<{ ruleId: 'runtime-secret-in-bundle'; regex: RegExp; label: string }> =
  [
    {
      ruleId: 'runtime-secret-in-bundle',
      regex: /sk_live_[A-Za-z0-9]+/g,
      label: 'Stripe live secret key',
    },
    {
      ruleId: 'runtime-secret-in-bundle',
      regex: /sk_test_[A-Za-z0-9]+/g,
      label: 'Stripe test secret key',
    },
    { ruleId: 'runtime-secret-in-bundle', regex: /AKIA[0-9A-Z]{16}/g, label: 'AWS access key' },
    {
      ruleId: 'runtime-secret-in-bundle',
      regex: /AIzaSy[A-Za-z0-9_-]{33}/g,
      label: 'Google API key',
    },
    {
      ruleId: 'runtime-secret-in-bundle',
      regex: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      label: 'JWT token',
    },
  ];

const REQUIRED_SECURITY_HEADERS = [
  { name: 'strict-transport-security', label: 'Strict-Transport-Security' },
  { name: 'x-content-type-options', label: 'X-Content-Type-Options' },
  { name: 'content-security-policy', label: 'Content-Security-Policy' },
] as const;

export function maskSecretValue(secret: string): string {
  const suffix = secret.slice(-4);
  if (secret.startsWith('sk_live_')) return `sk_live_****${suffix}`;
  if (secret.startsWith('sk_test_')) return `sk_test_****${suffix}`;
  if (secret.startsWith('AKIA')) return `AKIA****${suffix}`;
  if (secret.startsWith('AIzaSy')) return `AIzaSy****${suffix}`;
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}****${suffix}`;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isServiceRoleJwt(token: string): boolean {
  const payload = decodeJwtPayload(token);
  return payload?.role === 'service_role';
}

export function scanBundleForSecrets(bundleText: string): WebFinding[] {
  const findings: WebFinding[] = [];
  const seen = new Set<string>();

  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of bundleText.matchAll(pattern.regex)) {
      const value = match[0];
      if (!value || seen.has(value)) continue;

      if (pattern.label === 'JWT token' && !isServiceRoleJwt(value)) {
        continue;
      }

      seen.add(value);
      findings.push({
        ruleId: pattern.ruleId,
        severity: 'error',
        message: `${pattern.label} exposed in production bundle (${maskSecretValue(value)}).`,
        suggestion:
          'Remove secrets from client-side bundles and rotate the exposed credential immediately.',
        file: 'Runtime bundle',
      });
    }
  }

  return findings;
}

export function checkSecurityHeaders(headers: Headers): WebFinding[] {
  const missing = REQUIRED_SECURITY_HEADERS.filter((header) => !headers.get(header.name));

  if (missing.length === 0) return [];

  return [
    {
      ruleId: 'runtime-missing-security-headers',
      severity: 'warning',
      message: `Missing security headers: ${missing.map((header) => header.label).join(', ')}.`,
      suggestion:
        'Configure Strict-Transport-Security, X-Content-Type-Options, and Content-Security-Policy on the deployed app.',
      file: 'HTTP response',
    },
  ];
}

function supabaseHeaders(anonKey: string): HeadersInit {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    Accept: 'application/json',
  };
}

export async function probeSupabaseRls(
  supabaseUrl: string,
  anonKey: string,
  fetchImpl: typeof fetch = fetch,
  lookupImpl?: LookupImpl,
): Promise<WebFinding[]> {
  // supabaseUrl is extracted from the scanned page's own HTML/bundle text
  // (see extractSupabaseConfig) — it is attacker-controlled input, not a
  // trusted constant, and must go through the same SSRF guard as any other
  // scan target before it is ever fetched.
  assertScannableUrl(supabaseUrl);

  const findings: WebFinding[] = [];
  const openTables: string[] = [];

  for (const table of SENSITIVE_SUPABASE_TABLES) {
    const probeUrl = new URL(`/rest/v1/${table}`, supabaseUrl);
    probeUrl.searchParams.set('select', '*');
    probeUrl.searchParams.set('limit', '1');

    const { response } = await safeFetch(
      probeUrl.toString(),
      { headers: supabaseHeaders(anonKey) },
      fetchImpl,
      lookupImpl,
    );
    if (!response.ok) continue;

    let rows: unknown[] = [];
    try {
      const payload = (await response.json()) as unknown;
      rows = Array.isArray(payload) ? payload : [];
    } catch {
      continue;
    }

    if (rows.length > 0) {
      openTables.push(table);
      findings.push({
        ruleId: 'runtime-supabase-rls-open',
        severity: 'error',
        message: `Supabase table '${table}' returned rows via anon key without RLS protection.`,
        suggestion: `Enable row-level security and add policies for table '${table}'.`,
        file: 'Supabase REST API',
      });
    }
  }

  for (const table of openTables) {
    findings.push({
      ruleId: 'runtime-supabase-anon-write-implied',
      severity: 'warning',
      message: `Table '${table}' is readable with the anon key; write access is likely possible if RLS policies are missing.`,
      suggestion:
        'Add restrictive RLS policies for SELECT, INSERT, UPDATE, and DELETE. This check infers risk only — no write probe was attempted.',
      file: 'Supabase REST API',
    });
  }

  return findings;
}

export async function runtimeFetch(
  url: string,
  init: FetchInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  if (MUTATING_HTTP_METHODS.has(method)) {
    throw new Error(`Mutating HTTP method "${method}" is not allowed for runtime scans.`);
  }

  return fetchImpl(url, {
    ...init,
    method,
    signal: init.signal ?? AbortSignal.timeout(RUNTIME_FETCH_TIMEOUT_MS),
    // Redirects are never auto-followed: a target could 3xx to an internal
    // address, and `fetch`'s built-in follower would fetch it with no SSRF
    // check at all. safeFetch() below re-validates every hop instead.
    redirect: 'manual',
    headers: {
      Accept: 'text/html,application/javascript,text/javascript,*/*',
      ...init.headers,
    },
  } as FetchInit);
}

/**
 * Resolves a hostname and rejects it if any returned address is private or
 * blocked. Returns the address so callers can pin the actual TCP connection
 * to it (see createPinnedDispatcher) — resolving here and connecting
 * separately would let a DNS-rebinding attacker return a public address for
 * this check and a private one moments later for the real connection.
 */
async function resolveSafeHost(
  hostname: string,
  lookupImpl: LookupImpl = defaultLookup,
): Promise<ResolvedSafeHost> {
  const records = await lookupImpl(hostname);
  if (records.length === 0) {
    throw new Error('Target host could not be resolved.');
  }
  for (const record of records) {
    assertPublicIpAddress(record.address);
  }
  const [chosen] = records;
  return { address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}

/** Forces the underlying connection to the already-validated address instead
 *  of letting undici re-resolve DNS (and potentially land on a different,
 *  private address) when the request is actually dispatched. */
function createPinnedDispatcher(resolved: ResolvedSafeHost): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, [{ address: resolved.address, family: resolved.family }]);
      },
    },
  });
}

/**
 * The single entry point every runtime-scan fetch must go through. Validates
 * the URL, resolves + pins DNS to the validated address, and follows
 * redirects manually — each hop is re-validated (SSRF guard + fresh DNS
 * pin) exactly like the original request, so a target cannot redirect the
 * scanner to an internal address to bypass the guard.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
  lookupImpl: LookupImpl = defaultLookup,
): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = assertScannableUrl(rawUrl);

  for (let hop = 0; hop <= RUNTIME_MAX_REDIRECTS; hop += 1) {
    const resolved = await resolveSafeHost(currentUrl.hostname, lookupImpl);
    const dispatcher = createPinnedDispatcher(resolved);

    const response = await runtimeFetch(currentUrl.toString(), { ...init, dispatcher }, fetchImpl);

    if (!REDIRECT_STATUS_CODES.has(response.status)) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get('location');
    if (!location) {
      return { response, finalUrl: currentUrl };
    }

    currentUrl = assertScannableUrl(new URL(location, currentUrl).toString());
  }

  throw new Error('Too many redirects while scanning the target URL.');
}

function extractScriptUrls(html: string, pageUrl: URL): string[] {
  const urls = new Set<string>();
  const scriptSrcPattern = /<script[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(scriptSrcPattern)) {
    const src = match[1];
    if (!src || src.startsWith('data:')) continue;
    try {
      urls.add(new URL(src, pageUrl).toString());
    } catch {
      // Ignore malformed script URLs.
    }
  }
  return [...urls];
}

function extractSupabaseConfig(text: string): { supabaseUrl?: string; anonKey?: string } {
  const supabaseUrlMatch =
    text.match(/https?:\/\/[a-z0-9-]+\.supabase\.co/gi)?.[0] ??
    text.match(/NEXT_PUBLIC_SUPABASE_URL["'\s:=]+["'](https?:\/\/[^"']+)["']/i)?.[1];
  const anonKeyMatch =
    text.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY["'\s:=]+["'](eyJ[^"']+)["']/i)?.[1] ??
    text.match(/SUPABASE_ANON_KEY["'\s:=]+["'](eyJ[^"']+)["']/i)?.[1];

  let anonKey = anonKeyMatch;
  if (!anonKey) {
    for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
      const payload = decodeJwtPayload(token);
      if (payload?.role === 'anon') {
        anonKey = token;
        break;
      }
    }
  }

  return {
    supabaseUrl: supabaseUrlMatch ? supabaseUrlMatch.replace(/\/$/, '') : undefined,
    anonKey,
  };
}

async function readRuntimeResponseText(response: Response): Promise<string> {
  return readLimitedResponseText(response, RUNTIME_MAX_RESPONSE_BYTES);
}

export async function scanLiveUrl(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
  lookupImpl?: LookupImpl,
): Promise<WebFinding[]> {
  const { response: pageResponse, finalUrl: pageUrl } = await safeFetch(
    rawUrl,
    { method: 'GET' },
    fetchImpl,
    lookupImpl,
  );
  const findings: WebFinding[] = [...checkSecurityHeaders(pageResponse.headers)];

  const html = await readRuntimeResponseText(pageResponse);
  findings.push(...scanBundleForSecrets(html));

  const scriptUrls = extractScriptUrls(html, pageUrl).slice(0, 8);
  for (const scriptUrl of scriptUrls) {
    const { response: scriptResponse } = await safeFetch(
      scriptUrl,
      { method: 'GET' },
      fetchImpl,
      lookupImpl,
    );
    if (!scriptResponse.ok) continue;
    const bundleText = await readRuntimeResponseText(scriptResponse);
    findings.push(...scanBundleForSecrets(bundleText));
  }

  const supabaseConfig = extractSupabaseConfig(html);
  if (supabaseConfig.supabaseUrl && supabaseConfig.anonKey) {
    const supabaseFindings = await probeSupabaseRls(
      supabaseConfig.supabaseUrl,
      supabaseConfig.anonKey,
      fetchImpl,
      lookupImpl,
    );
    findings.push(...supabaseFindings);
  }

  return findings;
}
