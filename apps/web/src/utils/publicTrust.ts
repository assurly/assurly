import type { Severity } from '@assurly/scanner-core';
import type { Target, TargetVerdict } from './dbAdapter';
import type { Verdict } from './shipGate';
import { resolveTargetShipScore } from './shipScoreDisplay';

/**
 * Whitelisted public projection for the badge / trust-page growth loop.
 * Shape only — never evidence rows, never PII, never org/webhook secrets.
 */
export interface PublicTrustProjection {
  displayName: string;
  identifier: string;
  kind: 'repo' | 'url';
  verdict: TargetVerdict;
  shipScore: number | null;
  lastCheckedAt: string | null;
  generatorFingerprint: string | null;
  /**
   * The dominant issue as a COARSE, safe category only — never the raw finding
   * message and never a table-specific label. A public trust page must not name
   * the exact exploitable table of an app that is still `blocked`: that would
   * broadcast a live, unfixed vulnerability. Callers get severity + a generic
   * category so the page can convey "there is a database access-control issue"
   * without handing an attacker the target.
   */
  topIssue: {
    category: string;
    severity: Severity;
  } | null;
  /** Shareable badge token. The public trust page requires this to be present. */
  badgeToken: string;
}

/** Hosted (keyed API) projection — same shape as the public DTO, badge optional. */
export type HostedTrustProjection = Omit<PublicTrustProjection, 'badgeToken'> & {
  badgeToken: string | null;
};

export interface VerdictEvidenceShape {
  topIssue?: Verdict['topIssue'] | null;
  blockerSnapshot?: unknown;
  previousShipScore?: number | null;
}

/**
 * Maps an internal issue group key to a coarse public category. Derives ONLY
 * from the key PREFIX (and severity) — never the key tail, which can be a table
 * name (`rls:customers`), an env var name (`env:STRIPE_SECRET_KEY`), or a raw
 * message (`msg:…`). The internal `label`/`sampleMessage` are never consulted.
 */
export function toPublicIssueCategory(key: string, severity: Severity): string {
  const k = key.toLowerCase();

  // Explicit group-key prefixes win over substring heuristics: an `env:` group is
  // an undocumented-configuration issue regardless of the (unexposed) var name.
  if (k.startsWith('env:') || k.includes('undocumented-env')) {
    return 'Configuration & secrets management';
  }
  if (k.includes('rls') || k.includes('supabase') || k.includes('anon')) {
    return 'Database access control (RLS)';
  }
  if (
    k.includes('key-exposed') ||
    k.includes('secret') ||
    k.includes('token') ||
    k.includes('credential')
  ) {
    return 'Exposed secret or key';
  }
  if (k.includes('stripe') || k.includes('webhook')) {
    return 'Payment webhook verification';
  }
  if (k.includes('header')) {
    return 'Missing security headers';
  }
  if (k.includes('rsc') || k.includes('client-import')) {
    return 'Server/client boundary';
  }
  if (k.includes('cold-start') || k.includes('perf') || k.includes('edge')) {
    return 'Performance & runtime';
  }

  return severity === 'error' ? 'Security blocker' : 'Security review item';
}

/**
 * A one-line, GENERIC remediation for a coarse public category. Safe to expose to
 * agents/OEM callers because it advises on the category only — it never names the
 * app's exploitable table, env var, or any evidence. Mirrors the categories emitted
 * by `toPublicIssueCategory`; any unmatched category falls back to a neutral line.
 */
export function categoryRemediation(category: string): string {
  switch (category) {
    case 'Database access control (RLS)':
      return 'Enable Row-Level Security on every Supabase table and add owner-scoped policies.';
    case 'Exposed secret or key':
      return 'Rotate the exposed credential and move it to a server-only environment variable.';
    case 'Configuration & secrets management':
      return 'Document required environment variables and keep secrets out of client bundles.';
    case 'Payment webhook verification':
      return 'Verify the Stripe webhook signature before trusting any event payload.';
    case 'Missing security headers':
      return 'Add the recommended security response headers (CSP, HSTS, X-Content-Type-Options).';
    case 'Server/client boundary':
      return 'Keep server-only modules out of client components to avoid leaking server code.';
    case 'Performance & runtime':
      return 'Review runtime/cold-start and edge configuration for the affected routes.';
    default:
      return 'Review the flagged issue in the Assurly dashboard and apply the suggested fix.';
  }
}

/** Builds the hosted DTO. Does not require a public badge token. */
export function toHostedTrustProjection(target: Target): HostedTrustProjection {
  const evidence = (target.verdict_evidence ?? {}) as VerdictEvidenceShape;
  const top = evidence.topIssue ?? null;

  return {
    displayName: target.display_name ?? target.identifier,
    identifier: target.identifier,
    kind: target.kind,
    verdict: target.current_verdict ?? 'unknown',
    shipScore: resolveTargetShipScore(target),
    lastCheckedAt: target.last_checked_at,
    generatorFingerprint: target.generator_fingerprint,
    topIssue: top
      ? {
          category: toPublicIssueCategory(top.key, top.severity),
          severity: top.severity,
        }
      : null,
    badgeToken: target.badge_token,
  };
}

/** Builds the public DTO. Returns null when the target has no shareable badge token. */
export function toPublicTrustProjection(target: Target): PublicTrustProjection | null {
  if (!target.badge_token) return null;
  const hosted = toHostedTrustProjection(target);
  return { ...hosted, badgeToken: target.badge_token };
}

/** Keys allowed on a public trust JSON response — used by tests. */
export const PUBLIC_TRUST_KEYS = [
  'displayName',
  'identifier',
  'kind',
  'verdict',
  'shipScore',
  'lastCheckedAt',
  'generatorFingerprint',
  'topIssue',
  'badgeToken',
] as const;
