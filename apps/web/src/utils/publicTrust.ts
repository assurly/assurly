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
  /** Safe one-line top issue (label + sample message only — no raw rows). */
  topIssue: {
    label: string;
    sampleMessage: string;
  } | null;
  badgeToken: string;
}

export interface VerdictEvidenceShape {
  topIssue?: Verdict['topIssue'] | null;
  blockerSnapshot?: unknown;
  previousShipScore?: number | null;
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
          label: top.label,
          sampleMessage: top.sampleMessage,
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
