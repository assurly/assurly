import type { ScanGateVerdict } from './dbAdapter';
import type { Verdict } from './shipGate';

/**
 * Findings persisted per scan are capped here, on both write paths (browser
 * `POST /api/scans`, CLI `POST /api/v1/scans`). Clients score ALL of their
 * findings first and persist an error-first slice.
 */
export const PERSISTED_FINDINGS_LIMIT = 100;

type GateVerdict = Exclude<ScanGateVerdict, 'failed'>;

/** What the client says its Ship Gate is. Either half may be absent. */
export interface GateClaim {
  shipScore?: number | null;
  verdict?: ScanGateVerdict | null;
}

export type ClaimRejection = 'better-than-evidence' | 'differs-without-truncation';

export interface AuthoritativeGate {
  shipScore: number;
  verdict: GateVerdict;
  /**
   * `server`: recomputed from the persisted findings. `client`: the claim,
   * accepted because truncation hides evidence the server cannot see and the
   * claim is no better than what the persisted findings prove.
   */
  source: 'server' | 'client';
  /** Present when a claim was made and not stored. */
  rejectedClaim?: {
    shipScore: number | null;
    verdict: ScanGateVerdict | null;
    reason: ClaimRejection;
  };
}

export interface ResolveAuthoritativeGateInput {
  /** The server's own Ship Gate over the findings being persisted. */
  computed: Pick<Verdict, 'shipScore' | 'status'>;
  claim: GateClaim;
  persistedFindingCount: number;
}

const VERDICT_RANK: Record<GateVerdict, number> = { ready: 0, review: 1, blocked: 2 };

/**
 * The stored Ship Gate can never be better than the stored findings prove.
 *
 * The server recomputes the gate from the persisted findings. The client
 * scored its full finding set, of which at most PERSISTED_FINDINGS_LIMIT are
 * persisted, so the only evidence the server can be missing is evidence that
 * makes the gate WORSE. Hence:
 *
 * - slice not truncated → same inputs, same function: any difference is a
 *   drift or a forged claim; the computation stands and the claim is reported;
 * - slice truncated → a claim no better than the computation (lower or equal
 *   score, equal or worse verdict) is the more complete truth and is kept;
 *   a better one is rejected.
 *
 * A `failed` verdict is not a gate claim — the caller decides failure.
 */
export function resolveAuthoritativeGate(input: ResolveAuthoritativeGateInput): AuthoritativeGate {
  const { computed, claim, persistedFindingCount } = input;
  const base: AuthoritativeGate = {
    shipScore: computed.shipScore,
    verdict: computed.status,
    source: 'server',
  };

  const claimedScore = claim.shipScore ?? null;
  // `failed` is not a gate; the caller decides failure. Treat it as no verdict claim.
  const claimedVerdict = claim.verdict === 'failed' ? null : (claim.verdict ?? null);
  if (claimedScore === null && claimedVerdict === null) return base;

  const score = claimedScore ?? computed.shipScore;
  const verdict = claimedVerdict ?? computed.status;
  if (score === computed.shipScore && verdict === computed.status) return base;

  const rejected = (reason: ClaimRejection): AuthoritativeGate => ({
    ...base,
    rejectedClaim: { shipScore: claimedScore, verdict: claim.verdict ?? null, reason },
  });
  const better =
    score > computed.shipScore || VERDICT_RANK[verdict] < VERDICT_RANK[computed.status];
  if (better) return rejected('better-than-evidence');
  if (persistedFindingCount < PERSISTED_FINDINGS_LIMIT) {
    return rejected('differs-without-truncation');
  }
  return { shipScore: score, verdict, source: 'client' };
}

/**
 * Structured log for a rejected claim — the signal that the browser or CLI
 * scoring has drifted from the server, or that a client is inflating its gate.
 */
export function logRejectedGateClaim(details: {
  route: string;
  repoId: string;
  gate: AuthoritativeGate;
  computed: Pick<Verdict, 'shipScore' | 'status'>;
  persistedFindingCount: number;
}): void {
  const { gate } = details;
  if (!gate.rejectedClaim) return;
  console.warn(
    JSON.stringify({
      service: 'assurly-api',
      event: 'ship-gate-claim-rejected',
      route: details.route,
      repoId: details.repoId,
      reason: gate.rejectedClaim.reason,
      claimedShipScore: gate.rejectedClaim.shipScore,
      claimedVerdict: gate.rejectedClaim.verdict,
      computedShipScore: details.computed.shipScore,
      computedVerdict: details.computed.status,
      persistedFindingCount: details.persistedFindingCount,
    }),
  );
}
