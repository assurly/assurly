import type { TargetKind } from '../dbAdapter';

export interface ActiveProbeGateInput {
  kind: TargetKind;
  ownershipVerified: boolean;
}

/**
 * The single server-side authority for whether the ACTIVE proof-probe (Supabase
 * RLS row-pull, auth-boundary probing) may run against a target. Passive checks
 * (headers, public-bundle secrets) are always allowed and never consult this.
 *
 * - `repo` targets are implicitly owned (connected via the GitHub App), so the
 *   active probe is allowed through the repo/scan path.
 * - `url` targets require proven ownership (`ownership_verified = true`); an
 *   unverified arbitrary URL never gets an active data-pull.
 *
 * This must be the only gate any probe entrypoint uses so the boundary cannot
 * drift between routes.
 */
export function isActiveProbeAllowed(input: ActiveProbeGateInput): boolean {
  switch (input.kind) {
    case 'repo':
      return true;
    case 'url':
      return input.ownershipVerified === true;
    default: {
      const exhaustive: never = input.kind;
      return exhaustive;
    }
  }
}

/**
 * Canonical identifier for a `url` target: the origin only. Ownership is proven
 * per site (host), so `https://app.com/a` and `https://app.com/b` share one
 * target and one verification.
 */
export function normalizeUrlIdentifier(rawUrl: string): string {
  return new URL(rawUrl).origin;
}
