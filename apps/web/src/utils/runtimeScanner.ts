import { lookup } from 'node:dns/promises';
import { Agent } from 'undici';
import {
  containsAssurlyCanaryCallbackPath,
  containsAssurlyCanaryToken,
  isAssurlyCanaryToken,
} from '@assurly/scanner-core';
import type { WebFinding } from './browserScanner';
import type { ClaudeClientDeps } from './ai/claudeClient';
import {
  buildDeterministicEndpointPlan,
  extractHeuristicApiPaths,
  extractHeuristicTableNames,
  planRedTeamProbes,
} from './ai/redTeamPlanner';
import { readLimitedResponseText } from './githubApp';
import {
  DEFAULT_SENSITIVE_SUPABASE_TABLES,
  executeProbePlan,
  PROBE_MAX_STEPS,
  sanitizeProbePlan,
  type ProbePlanStep,
} from './probes';
import {
  SCANNER_IDENTITY_HEADER,
  type BlockedScan,
  type BlockedScanSource,
} from './scannerBlocked';
import { assertPublicIpAddress, assertScannableUrl } from './urlSafety';
import { scanVisibility, type VisibilityInput, type VisibilityReport } from './visibilityScan';

export const RUNTIME_FETCH_TIMEOUT_MS = 8_000;
export const RUNTIME_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const RUNTIME_MAX_REDIRECTS = 5;
/**
 * Shared wall-clock budget for the entire SEO & GEO supplementary fetch step
 * (robots.txt, llms.txt, sitemap.xml, og:image HEAD). When exhausted, remaining
 * inputs stay `undefined` so Phase 1 marks those checks `'skipped'` — a slow
 * site must never meaningfully extend the main security scan.
 */
export const VISIBILITY_AUDIT_BUDGET_MS = 4_000;
/**
 * Bundle-fetch phase — how much of a page's `<script src>` and
 * `<link rel="modulepreload">` tree the scanner reads. Next.js/Turbopack pages
 * ship 10–20 chunks and put the app's own code (its `/api/…` literals, env leaks,
 * Supabase config) LAST, so a small count cap reads polyfills and nothing else.
 * Bounded three ways so a page with 200 script tags, 5 MB chunks, or a stalling
 * CDN cannot stretch a scan: count, total bytes, wall-clock. One script failing
 * is skipped, never fatal — the page itself already loaded.
 */
export const BUNDLE_MAX_SCRIPTS = 24;
export const BUNDLE_MAX_TOTAL_BYTES = 12 * 1024 * 1024;
export const BUNDLE_FETCH_BUDGET_MS = 10_000;

const MUTATING_HTTP_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Bot protection (Cloudflare, WAFs) challenges any request whose User-Agent is
 * not a mainstream browser — measurably including honest ones that name the
 * scanner, which turned live sites into false "unreachable" verdicts. A runtime
 * probe is a read-only GET of a page the user asked us to open, so it presents
 * as a browser and identifies itself out-of-band in SCANNER_IDENTITY_HEADER,
 * which a host can allowlist. Never fold that identity into this string.
 */
const RUNTIME_SCANNER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const RUNTIME_SCANNER_IDENTITY = 'ship-gate/1.0 (+https://assurly.dev/scanner)';

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

interface RequiredSecurityHeader {
  /** Lower-cased response-header name to probe for. */
  name: string;
  /** Human-readable header name for messages and remediation. */
  label: string;
  /** Recommended value to set. */
  value: string;
  /**
   * When true the value is a strict starting point the user must widen before
   * relying on it (currently only the CSP), so remediation appends a caveat
   * instead of presenting it as a drop-in value.
   */
  needsTuning?: boolean;
}

const REQUIRED_SECURITY_HEADERS: readonly RequiredSecurityHeader[] = [
  {
    name: 'strict-transport-security',
    label: 'Strict-Transport-Security',
    value: 'max-age=63072000',
  },
  { name: 'x-content-type-options', label: 'X-Content-Type-Options', value: 'nosniff' },
  {
    name: 'content-security-policy',
    label: 'Content-Security-Policy',
    value: "default-src 'self'",
    needsTuning: true,
  },
];

type MissingSecurityHeader = RequiredSecurityHeader;

/** The only platform we tailor remediation for; everything else gets generic guidance. */
function detectDeployPlatform(headers: Headers): 'vercel' | 'unknown' {
  return (headers.get('server') ?? '').toLowerCase().includes('vercel') ? 'vercel' : 'unknown';
}

/** Turns the missing headers into a concrete, copy-friendly fix for the detected platform. */
function buildSecurityHeaderRemediation(
  missing: readonly MissingSecurityHeader[],
  platform: 'vercel' | 'unknown',
): string {
  const pairs = missing.map((header) => `${header.label}: ${header.value}`).join('; ');
  const cspNote = missing.some((header) => header.needsTuning)
    ? " Widen the Content-Security-Policy to the origins your app actually loads before you rely on it — 'self' alone will block external scripts, styles, and images."
    : '';

  if (platform === 'vercel') {
    return `Detected Vercel. Add the missing header(s) to vercel.json under "headers" (source "/(.*)") — ${pairs} — then redeploy.${cspNote}`;
  }
  return `Set the missing header(s) on the deployed app — ${pairs}. For Next.js return them from headers() in next.config.js; behind a CDN or reverse proxy add them as response headers.${cspNote}`;
}

export function maskSecretValue(secret: string): string {
  const suffix = secret.slice(-4);
  if (secret.startsWith('sk_live_')) return `sk_live_****${suffix}`;
  if (secret.startsWith('sk_test_')) return `sk_test_****${suffix}`;
  if (secret.startsWith('AKIA')) return `AKIA****${suffix}`;
  if (secret.startsWith('AIzaSy')) return `AIzaSy****${suffix}`;
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}****${suffix}`;
}

/** The four proof categories the product renders and persists (see probe_evidence). */
export type ProbeEvidenceKind = 'rls_rows' | 'exposed_secret' | 'open_endpoint' | 'missing_header';

/**
 * Shape + masked sample ONLY — never raw PII. This is what a probe is allowed to
 * hand back to the rest of the app; redaction happens here inside the scanner so
 * raw personal data never leaves it (convention §2.8).
 */
export interface RedactedSample {
  rowCount?: number;
  columns?: string[];
  sampleCell?: string;
  table?: string;
  secretLabel?: string;
  maskedSecret?: string;
  headers?: string[];
  /** Same-origin API path. Never the origin — the url target already knows it. */
  path?: string;
}

/** A single, already-redacted proof artifact tied to a finding by rule id. */
export interface ProbeEvidence {
  findingRuleId: string;
  kind: ProbeEvidenceKind;
  summary: string;
  redactedSample?: RedactedSample;
}

/**
 * Masks a single retrieved cell so we can prove data was readable without ever
 * exposing the real value. Emails keep their shape (`t***@***.com`); everything
 * else collapses to a first-character stub.
 */
export function redactCell(value: unknown): string {
  if (value === null || value === undefined) return '(empty)';
  if (typeof value === 'number' || typeof value === 'boolean') return '***';
  const str = String(value);
  const email = str.match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
  if (email) {
    const local = email[1];
    const tld = email[2].split('.').pop() ?? '';
    return `${local[0] ?? ''}***@***.${tld}`;
  }
  if (str.length <= 1) return '***';
  return `${str[0]}***`;
}

/** Picks a representative, masked sample cell from a retrieved row. */
export function pickRedactedSampleCell(row: Record<string, unknown>): string | undefined {
  const stringEntry = Object.values(row).find(
    (value) => typeof value === 'string' && value.length > 0,
  );
  if (stringEntry !== undefined) return redactCell(stringEntry);
  const anyEntry = Object.values(row)[0];
  return anyEntry === undefined ? undefined : redactCell(anyEntry);
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

export function scanBundleForSecretsWithEvidence(bundleText: string): {
  findings: WebFinding[];
  evidence: ProbeEvidence[];
} {
  const findings: WebFinding[] = [];
  const evidence: ProbeEvidence[] = [];
  const seen = new Set<string>();

  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of bundleText.matchAll(pattern.regex)) {
      const value = match[0];
      if (!value || seen.has(value)) continue;
      // Planted Assurly canaries are intentional tripwires, not leaks.
      if (
        containsAssurlyCanaryToken(value) ||
        isAssurlyCanaryToken(value) ||
        containsAssurlyCanaryCallbackPath(value)
      ) {
        continue;
      }

      if (pattern.label === 'JWT token' && !isServiceRoleJwt(value)) {
        continue;
      }

      seen.add(value);
      const masked = maskSecretValue(value);
      findings.push({
        ruleId: pattern.ruleId,
        severity: 'error',
        message: `${pattern.label} exposed in production bundle (${masked}).`,
        suggestion:
          'Remove secrets from client-side bundles and rotate the exposed credential immediately.',
        file: 'Runtime bundle',
      });
      evidence.push({
        findingRuleId: pattern.ruleId,
        kind: 'exposed_secret',
        summary: `${pattern.label} is readable in your app's public code (${masked}).`,
        redactedSample: { secretLabel: pattern.label, maskedSecret: masked },
      });
    }
  }

  return { findings, evidence };
}

export function scanBundleForSecrets(bundleText: string): WebFinding[] {
  return scanBundleForSecretsWithEvidence(bundleText).findings;
}

/**
 * Canary token or `/api/canary/` path in public HTML/JS. Warning only — not a
 * new blocker. Must never HTTP-fetch the callback (self-hit).
 */
export function scanBundleForCanaryInClient(bundleText: string): WebFinding[] {
  if (!containsAssurlyCanaryToken(bundleText) && !containsAssurlyCanaryCallbackPath(bundleText)) {
    return [];
  }
  return [
    {
      ruleId: 'assurly-canary-in-client',
      severity: 'warning',
      confidence: 'high',
      file: 'Runtime bundle',
      message: 'Assurly tripwire URL is in the public client bundle.',
      suggestion:
        'Tripwire is in public JS. Rotate real Stripe, Supabase, and GitHub secrets; take the canary off the client.',
    },
  ];
}

export function checkSecurityHeadersWithEvidence(headers: Headers): {
  findings: WebFinding[];
  evidence: ProbeEvidence[];
} {
  const missing = REQUIRED_SECURITY_HEADERS.filter((header) => !headers.get(header.name));

  if (missing.length === 0) return { findings: [], evidence: [] };

  const platform = detectDeployPlatform(headers);
  const labels = missing.map((header) => header.label);

  return {
    findings: [
      {
        ruleId: 'runtime-missing-security-headers',
        severity: 'warning',
        message: `Missing security headers: ${labels.join(', ')}.`,
        suggestion: buildSecurityHeaderRemediation(missing, platform),
        file: 'HTTP response',
      },
    ],
    evidence: [
      {
        findingRuleId: 'runtime-missing-security-headers',
        kind: 'missing_header',
        summary: `Your app is missing ${labels.length} protective header${labels.length === 1 ? '' : 's'}: ${labels.join(', ')}.`,
        redactedSample: { headers: labels },
      },
    ],
  };
}

export function checkSecurityHeaders(headers: Headers): WebFinding[] {
  return checkSecurityHeadersWithEvidence(headers).findings;
}

/**
 * Passive Supabase-exposure preview. A live app that ships a Supabase URL + anon
 * key in its public bundle has a database reachable straight from the browser.
 *
 * This is deliberately a `warning`, never a blocker: shipping the anon key is
 * normal Supabase usage and perfectly safe when row-level security is on. From
 * the outside we CANNOT tell whether the tables are actually readable — that
 * takes the active probe, which requires proven ownership. So the honest hook is
 * "the door is here; verify and we'll test whether the lock holds" — scary and
 * true, without claiming a breach we haven't proven or touching the data.
 *
 * Emitted only on passive scans. When the active probe runs it either proves an
 * open table (`runtime-supabase-rls-open`) or finds nothing, so this preview
 * would be redundant there and is suppressed.
 */
export function buildSupabaseExposureEvidence(
  supabaseUrl: string,
  anonKey: string,
): { findings: WebFinding[]; evidence: ProbeEvidence[] } {
  let host = supabaseUrl;
  try {
    host = new URL(supabaseUrl).host;
  } catch {
    // Keep the raw string if it is not a parseable URL.
  }
  const maskedKey = anonKey.length > 12 ? `${anonKey.slice(0, 8)}…${anonKey.slice(-4)}` : '…';

  return {
    findings: [
      {
        ruleId: 'runtime-supabase-key-exposed',
        severity: 'warning',
        message:
          "Your Supabase database is reachable directly from the browser with a public key shipped in this app's code. If any table is missing row-level security (RLS), anyone on the internet can read it. Verify you own this app and we'll prove exactly which tables are exposed.",
        suggestion:
          'The anon key being public is normal — an open RLS policy is what turns it into a breach. Verify ownership to run the full data-exfiltration test, then enable RLS with a policy on every table that holds user data.',
        file: 'Public app bundle',
      },
    ],
    evidence: [
      {
        findingRuleId: 'runtime-supabase-key-exposed',
        kind: 'open_endpoint',
        summary: `Your database at ${host} is reachable from any browser using the public key in your app's code — verify ownership and we'll test whether your tables are actually readable.`,
        redactedSample: {
          secretLabel: 'Supabase anon key',
          maskedSecret: maskedKey,
        },
      },
    ],
  };
}

/**
 * Layer-1 / test helper: probes the default sensitive table list via the
 * whitelisted `supabase_rls_table_read` primitive (no AI). Prefer
 * `scanLiveUrlWithEvidence({ activeProbe: true })` for the full ownership-gated path.
 */
export async function probeSupabaseRlsWithEvidence(
  supabaseUrl: string,
  anonKey: string,
  fetchImpl: typeof fetch = fetch,
  lookupImpl?: LookupImpl,
  tables: readonly string[] = DEFAULT_SENSITIVE_SUPABASE_TABLES,
): Promise<{ findings: WebFinding[]; evidence: ProbeEvidence[] }> {
  // supabaseUrl is extracted from the scanned page's own HTML/bundle text
  // (see extractSupabaseConfig) — it is attacker-controlled input, not a
  // trusted constant, and must go through the same SSRF guard as any other
  // scan target before it is ever fetched.
  assertScannableUrl(supabaseUrl);

  const plan: ProbePlanStep[] = tables.map((table) => ({
    primitive: 'supabase_rls_table_read',
    params: { table },
  }));

  const result = await executeProbePlan(plan, {
    targetOrigin: new URL(supabaseUrl).origin,
    supabaseUrl,
    anonKey,
    fetchImpl,
    lookupImpl,
    safeFetch,
  });

  return {
    findings: result.findings,
    evidence: result.evidence as ProbeEvidence[],
  };
}

export async function probeSupabaseRls(
  supabaseUrl: string,
  anonKey: string,
  fetchImpl: typeof fetch = fetch,
  lookupImpl?: LookupImpl,
): Promise<WebFinding[]> {
  const { findings } = await probeSupabaseRlsWithEvidence(
    supabaseUrl,
    anonKey,
    fetchImpl,
    lookupImpl,
  );
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
      'User-Agent': RUNTIME_SCANNER_USER_AGENT,
      [SCANNER_IDENTITY_HEADER]: RUNTIME_SCANNER_IDENTITY,
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

export interface SafeFetchOptions {
  /**
   * `'any'` (default) follows every safe redirect. `'same-origin'` hands a
   * redirect that leaves the starting origin back to the caller as the 3xx
   * it is, unfollowed — an active probe of an owned app must never carry the
   * scanner onto a third party (a login route 307s into an OAuth provider).
   */
  redirects?: 'any' | 'same-origin';
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
  options: SafeFetchOptions = {},
): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = assertScannableUrl(rawUrl);
  const startOrigin = currentUrl.origin;

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

    const nextUrl = assertScannableUrl(new URL(location, currentUrl).toString());
    if (options.redirects === 'same-origin' && nextUrl.origin !== startOrigin) {
      return { response, finalUrl: currentUrl };
    }
    currentUrl = nextUrl;
  }

  throw new Error('Too many redirects while scanning the target URL.');
}

function extractScriptUrls(html: string, pageUrl: URL): string[] {
  const urls = new Set<string>();
  const tagPattern = /<(script|link)\b[^>]*>/gi;
  for (const match of html.matchAll(tagPattern)) {
    const tag = match[0];
    const kind = match[1]?.toLowerCase();
    let href: string | null = null;
    if (kind === 'script') {
      href = getHtmlTagAttr(tag, 'src');
    } else if (kind === 'link') {
      const rel = getHtmlTagAttr(tag, 'rel');
      if (!rel || !rel.toLowerCase().split(/\s+/).includes('modulepreload')) continue;
      href = getHtmlTagAttr(tag, 'href');
    }
    if (!href || href.startsWith('data:')) continue;
    if (containsAssurlyCanaryCallbackPath(href) || containsAssurlyCanaryToken(href)) continue;
    try {
      urls.add(new URL(href, pageUrl).toString());
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

function getHtmlTagAttr(tag: string, name: string): string | null {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i');
  const quotedMatch = tag.match(quoted);
  if (quotedMatch?.[2] !== undefined) return quotedMatch[2];
  const unquoted = new RegExp(`\\b${name}\\s*=\\s*([^\\s>/"']+)`, 'i');
  return tag.match(unquoted)?.[1] ?? null;
}

/** Extracts `og:image` content from raw HTML (no DOM — same style as Phase 1). */
function extractOgImageHref(html: string): string | null {
  const metaPattern = /<meta\b[^>]*>/gi;
  for (const match of html.matchAll(metaPattern)) {
    const tag = match[0];
    const property = getHtmlTagAttr(tag, 'property');
    if (property && property.toLowerCase() === 'og:image') {
      const content = getHtmlTagAttr(tag, 'content');
      if (content && content.trim()) return content.trim();
    }
  }
  return null;
}

type VisibilitySupplementary = Pick<
  VisibilityInput,
  'robotsTxt' | 'sitemapXml' | 'llmsTxt' | 'ogImage'
>;

/**
 * Fetches the SEO/GEO supplementary inputs under a shared wall-clock budget.
 * Never throws: non-2xx / thrown fetch → `null`; not attempted (budget) → `undefined`.
 * Every request goes through `safeFetch` (SSRF pin + redirect re-validation).
 */
async function fetchVisibilitySupplementary(
  html: string,
  pageUrl: URL,
  fetchImpl: typeof fetch,
  lookupImpl?: LookupImpl,
): Promise<VisibilitySupplementary> {
  const deadline = Date.now() + VISIBILITY_AUDIT_BUDGET_MS;
  const remainingMs = (): number => Math.max(0, deadline - Date.now());

  async function fetchTextPath(path: string): Promise<string | null | undefined> {
    const budgetLeft = remainingMs();
    if (budgetLeft <= 0) return undefined;
    try {
      const target = new URL(path, pageUrl).toString();
      const { response } = await safeFetch(
        target,
        { method: 'GET', signal: AbortSignal.timeout(budgetLeft) },
        fetchImpl,
        lookupImpl,
      );
      if (!response.ok) return null;
      return await readRuntimeResponseText(response);
    } catch {
      // Attempted but failed (network, timeout, SSRF, non-scannable) → absent.
      return null;
    }
  }

  async function fetchOgImageHead(): Promise<VisibilityInput['ogImage']> {
    const declared = extractOgImageHref(html);
    if (!declared) return undefined;

    const budgetLeft = remainingMs();
    if (budgetLeft <= 0) return undefined;

    let absolute: string;
    try {
      absolute = new URL(declared, pageUrl).toString();
    } catch {
      return null;
    }

    try {
      const { response } = await safeFetch(
        absolute,
        { method: 'HEAD', signal: AbortSignal.timeout(budgetLeft) },
        fetchImpl,
        lookupImpl,
      );
      if (!response.ok) return null;
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
      };
    } catch {
      return null;
    }
  }

  const robotsTxt = await fetchTextPath('/robots.txt');
  const llmsTxt = await fetchTextPath('/llms.txt');
  const sitemapXml = await fetchTextPath('/sitemap.xml');
  const ogImage = await fetchOgImageHead();

  return { robotsTxt, llmsTxt, sitemapXml, ogImage };
}

interface FetchedBundle {
  /** Script bodies in page order — order matters to `extractSupabaseConfig`'s first-match. */
  texts: string[];
  coverage: BundleCoverage;
}

/**
 * Reads the page's external scripts, in page order, under the bundle budgets.
 * A script that cannot be read is skipped: a stalled third-party CDN, an
 * oversized chunk, or a `<script src>` pointing at a private host must not turn
 * a reachable page into "Scan failed". The private-host case is refused by
 * `safeFetch` before any request goes out and simply counts as failed.
 */
async function fetchBundleScripts(
  scriptUrls: readonly string[],
  fetchImpl: typeof fetch,
  lookupImpl?: LookupImpl,
): Promise<FetchedBundle> {
  const deadline = Date.now() + BUNDLE_FETCH_BUDGET_MS;
  const texts: string[] = [];
  let failed = 0;
  let totalBytes = 0;
  let truncatedBy: BundleCoverage['truncatedBy'];

  for (const [index, scriptUrl] of scriptUrls.entries()) {
    if (index >= BUNDLE_MAX_SCRIPTS) {
      truncatedBy = 'count';
      break;
    }
    if (totalBytes >= BUNDLE_MAX_TOTAL_BYTES) {
      truncatedBy = 'bytes';
      break;
    }
    const budgetLeft = deadline - Date.now();
    if (budgetLeft <= 0) {
      truncatedBy = 'time';
      break;
    }

    try {
      const { response } = await safeFetch(
        scriptUrl,
        {
          method: 'GET',
          signal: AbortSignal.timeout(Math.min(budgetLeft, RUNTIME_FETCH_TIMEOUT_MS)),
        },
        fetchImpl,
        lookupImpl,
      );
      if (!response.ok) {
        failed += 1;
        continue;
      }
      const text = await readRuntimeResponseText(response);
      totalBytes += Buffer.byteLength(text, 'utf8');
      texts.push(text);
    } catch {
      // Timeout, oversize body, unsafe URL, DNS failure — this script only.
      failed += 1;
    }
  }

  return {
    texts,
    coverage: {
      scripts: scriptUrls.length,
      fetched: texts.length,
      failed,
      ...(truncatedBy ? { truncatedBy } : {}),
    },
  };
}

/**
 * Runs the Phase 1 visibility scorer. Failures degrade to `undefined` so the
 * security scan always completes. The report must NEVER enter `findings`.
 */
async function runVisibilityAudit(
  html: string,
  pageUrl: URL,
  fetchImpl: typeof fetch,
  lookupImpl?: LookupImpl,
): Promise<VisibilityReport | undefined> {
  try {
    const supplementary = await fetchVisibilitySupplementary(html, pageUrl, fetchImpl, lookupImpl);
    return scanVisibility({
      html,
      finalUrl: pageUrl.toString(),
      ...supplementary,
    });
  } catch {
    return undefined;
  }
}

export interface ScanLiveUrlOptions {
  /**
   * When false (the default), only PASSIVE checks run — missing security headers
   * and secrets leaked into the public bundle. The ACTIVE Supabase RLS row-pull
   * (which retrieves real data from a third-party database) requires proven
   * ownership. Callers must NOT set this to true for a `url` target unless
   * `isActiveProbeAllowed` (see utils/ownership/gate.ts) returned true — that is
   * the single server-side authority for the passive/active boundary. Never
   * enable this for anonymous or unverified arbitrary URLs.
   *
   * The AI red-team planner runs ONLY inside this branch — never around the gate.
   */
  activeProbe?: boolean;
  /**
   * When true, runs the SEO & GEO (visibility) audit as a parallel report —
   * robots.txt / llms.txt / sitemap.xml / og:image HEAD under
   * `VISIBILITY_AUDIT_BUDGET_MS`. Defaults to false. The result travels on
   * `ScanLiveUrlResult.visibility` only; it must NEVER enter `findings` or
   * Ship Gate scoring.
   */
  visibilityAudit?: boolean;
  /** Org id for AI budget accounting (planner). Optional. */
  organizationId?: string;
  /**
   * When false, the active path uses the deterministic table plan only (no LLM).
   * Defaults to true; AI failures still degrade to the deterministic plan.
   */
  useAiPlanner?: boolean;
  /** Injectable Claude deps (tests). */
  aiDeps?: ClaudeClientDeps;
}

/** How much of the page's script tree the scan actually read. */
export interface BundleCoverage {
  /** `<script src>` and `<link rel="modulepreload">` URLs found on the page. */
  scripts: number;
  /** Scripts whose body was read into the bundle text. */
  fetched: number;
  /** Scripts attempted but not read — non-2xx, timeout, oversize, unsafe URL. */
  failed: number;
  /** Set when scripts were left unfetched because a budget ran out. */
  truncatedBy?: 'count' | 'bytes' | 'time';
}

export interface ScanLiveUrlResult {
  findings: WebFinding[];
  evidence: ProbeEvidence[];
  /** Whether the active plan came from AI or the deterministic fallback. */
  planSource?: 'ai' | 'deterministic';
  /**
   * Script coverage of a completed scan. Absent when the target was dead or
   * blocked (no bundle phase ran). A truncated or partly failed bundle means
   * findings that live in the unread chunks were not looked for.
   */
  bundleCoverage?: BundleCoverage;
  /**
   * HTML + fetched bundle text captured during the scan. Used server-side for
   * generator fingerprinting only — never include this in a client JSON response.
   */
  pageText: string;
  /**
   * SEO & GEO audit — present only when `visibilityAudit` was enabled.
   * Parallel to Ship Gate; never merged into `findings`.
   */
  visibility?: VisibilityReport;
  /**
   * Set when the target answered but refused the scanner. `findings` is then
   * empty because we never saw the app — NOT because the app is clean, so
   * callers must not derive a verdict, a Ship Score or a fix outcome from it.
   */
  blocked?: BlockedScan;
}

/** Attributes the refusal so the user gets a fix they can actually act on. */
function detectBlockSource(status: number, headers: Headers): BlockedScanSource {
  if (status === 429) return 'rate-limit';
  const server = (headers.get('server') ?? '').toLowerCase();
  if (headers.get('cf-mitigated') || server.includes('cloudflare')) return 'cloudflare';
  if (detectDeployPlatform(headers) === 'vercel') return 'vercel';
  return 'unknown';
}

function isDeploymentNotFoundBody(body: string): boolean {
  const normalized = body.toLowerCase();
  return (
    normalized.includes('deployment_not_found') ||
    normalized.includes('deployment not found') ||
    (normalized.includes('404: not found') && normalized.includes('vercel'))
  );
}

export async function scanLiveUrlWithEvidence(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
  lookupImpl?: LookupImpl,
  options: ScanLiveUrlOptions = {},
): Promise<ScanLiveUrlResult> {
  const { response: pageResponse, finalUrl: pageUrl } = await safeFetch(
    rawUrl,
    { method: 'GET' },
    fetchImpl,
    lookupImpl,
  );
  const findings: WebFinding[] = [];
  const evidence: ProbeEvidence[] = [];
  let planSource: 'ai' | 'deterministic' | undefined;

  // Dead deploys (404/410/5xx / Vercel DEPLOYMENT_NOT_FOUND) must never look READY.
  // Read a short body preview first so we can short-circuit before header/SEO noise.
  const html = await readRuntimeResponseText(pageResponse);
  const isDead =
    pageResponse.status === 404 ||
    pageResponse.status === 410 ||
    pageResponse.status >= 500 ||
    isDeploymentNotFoundBody(html);
  if (isDead) {
    findings.push({
      ruleId: 'runtime-target-unreachable',
      severity: 'error',
      confidence: 'high',
      file: pageUrl.toString(),
      message: `Live target returned HTTP ${pageResponse.status} and is not reachable for a ship check.`,
      suggestion:
        'Confirm the deployment URL is live (not a removed Vercel deployment) before trusting a Ship Score.',
    });
    evidence.push({
      findingRuleId: 'runtime-target-unreachable',
      kind: 'open_endpoint',
      summary: `Target responded with HTTP ${pageResponse.status} and is unreachable.`,
    });
    return { findings, evidence, pageText: html, ...(planSource ? { planSource } : {}) };
  }

  // Everything else non-2xx means the target answered but would not let us in:
  // deployment protection, a WAF bot challenge, a rate limit. Calling that a
  // dead deploy punishes an app for being protected, so we report no verdict.
  if (!pageResponse.ok) {
    return {
      findings: [],
      evidence: [],
      pageText: html,
      blocked: {
        status: pageResponse.status,
        source: detectBlockSource(pageResponse.status, pageResponse.headers),
      },
    };
  }

  const headerResult = checkSecurityHeadersWithEvidence(pageResponse.headers);
  findings.push(...headerResult.findings);
  evidence.push(...headerResult.evidence);
  const htmlSecrets = scanBundleForSecretsWithEvidence(html);
  findings.push(...htmlSecrets.findings);
  evidence.push(...htmlSecrets.evidence);

  const bundle = await fetchBundleScripts(extractScriptUrls(html, pageUrl), fetchImpl, lookupImpl);
  let bundleTextAccum = html;
  for (const bundleText of bundle.texts) {
    bundleTextAccum += `\n${bundleText}`;
    const bundleSecrets = scanBundleForSecretsWithEvidence(bundleText);
    findings.push(...bundleSecrets.findings);
    evidence.push(...bundleSecrets.evidence);
  }

  const canaryInClient = scanBundleForCanaryInClient(bundleTextAccum);
  findings.push(...canaryInClient);

  const supabaseConfig = extractSupabaseConfig(bundleTextAccum);

  // Active data-exfiltration proof: only when the caller has established the user
  // may probe this target (ownership gate). Passive scans skip it — and the planner
  // never runs outside this branch.
  if (options.activeProbe) {
    const hasSupabase = Boolean(supabaseConfig.supabaseUrl && supabaseConfig.anonKey);
    const heuristicApiPaths = extractHeuristicApiPaths(bundleTextAccum);

    // The planner runs for every ownership-verified target. Supabase-only
    // fields are passed only when a config was observed; the deterministic
    // endpoint plan is always merged in so an empty/failed AI plan still
    // yields today's /api/… checklist.
    const endpointPlan = buildDeterministicEndpointPlan({
      targetOrigin: pageUrl.origin,
      hasSupabase,
      heuristicApiPaths,
    });

    const { plan, source } = await planRedTeamProbes(
      {
        targetOrigin: pageUrl.origin,
        hasSupabase,
        ...(hasSupabase && supabaseConfig.supabaseUrl
          ? { supabaseHost: new URL(supabaseConfig.supabaseUrl).host }
          : {}),
        ...(hasSupabase ? { heuristicTables: extractHeuristicTableNames(bundleTextAccum) } : {}),
        heuristicApiPaths,
        scannedSnippet: bundleTextAccum.slice(0, 4_000),
      },
      {
        organizationId: options.organizationId,
        useAi: options.useAiPlanner !== false,
        deps: options.aiDeps,
      },
    );
    planSource = source;

    // Each plan keeps its own step budget; sanitising the union drops any
    // endpoint step the planner duplicated so nothing is probed twice. The
    // planner result goes first (Supabase steps when present, then any AI
    // endpoint picks); the deterministic endpoint plan fills the rest. Both
    // share one time budget, and a proven open table outranks an open route —
    // slow /api routes must not starve it.
    const maxSteps = endpointPlan.length + PROBE_MAX_STEPS;
    const probeResult = await executeProbePlan(
      sanitizeProbePlan([...plan, ...endpointPlan], maxSteps),
      {
        targetOrigin: pageUrl.origin,
        ...(supabaseConfig.supabaseUrl ? { supabaseUrl: supabaseConfig.supabaseUrl } : {}),
        ...(supabaseConfig.anonKey ? { anonKey: supabaseConfig.anonKey } : {}),
        fetchImpl,
        lookupImpl,
        safeFetch,
        maxSteps,
      },
    );
    findings.push(...probeResult.findings);
    evidence.push(...(probeResult.evidence as ProbeEvidence[]));
  } else if (supabaseConfig.supabaseUrl && supabaseConfig.anonKey) {
    // Passive preview: we can see the database is reachable but must NOT probe it
    // without proven ownership. Surface the honest "verify to test the lock" hook.
    const exposure = buildSupabaseExposureEvidence(
      supabaseConfig.supabaseUrl,
      supabaseConfig.anonKey,
    );
    findings.push(...exposure.findings);
    evidence.push(...exposure.evidence);
  }

  // SEO & GEO audit — own field, never merged into findings / Ship Gate.
  let visibility: VisibilityReport | undefined;
  if (options.visibilityAudit) {
    visibility = await runVisibilityAudit(html, pageUrl, fetchImpl, lookupImpl);
  }

  return {
    findings,
    evidence,
    pageText: bundleTextAccum,
    bundleCoverage: bundle.coverage,
    ...(planSource ? { planSource } : {}),
    ...(visibility ? { visibility } : {}),
  };
}

export async function scanLiveUrl(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
  lookupImpl?: LookupImpl,
  options: ScanLiveUrlOptions = {},
): Promise<WebFinding[]> {
  const { findings } = await scanLiveUrlWithEvidence(rawUrl, fetchImpl, lookupImpl, options);
  return findings;
}
