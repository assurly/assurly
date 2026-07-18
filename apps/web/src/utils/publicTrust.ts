import type { Severity } from '@assurly/scanner-core';
import type { Target, TargetVerdict } from './dbAdapter';
import type { Verdict } from './shipGate';

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
  badgeToken: string;
}

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

/** Builds the public DTO. Returns null when the target has no shareable badge token. */
export function toPublicTrustProjection(target: Target): PublicTrustProjection | null {
  if (!target.badge_token) return null;

  const evidence = (target.verdict_evidence ?? {}) as VerdictEvidenceShape;
  const top = evidence.topIssue ?? null;

  return {
    displayName: target.display_name ?? target.identifier,
    identifier: target.identifier,
    kind: target.kind,
    verdict: target.current_verdict ?? 'unknown',
    shipScore: target.current_ship_score,
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
