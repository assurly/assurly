import { describe, expect, it } from 'vitest';
import {
  PERSISTED_FINDINGS_LIMIT,
  resolveAuthoritativeGate,
  type GateClaim,
} from './scanGateAuthority';

/**
 * The server recomputes the Ship Gate from the findings it persists. A client
 * scores ALL of its findings but persists at most PERSISTED_FINDINGS_LIMIT, so
 * the one thing the server cannot see is evidence that would make the score
 * WORSE. A claim is therefore accepted only when the persisted slice is
 * truncated and the claim is no better than the slice proves; the stored score
 * can never be better than the stored findings.
 */

const computed = { shipScore: 84, status: 'review' as const };

function resolve(claim: GateClaim, persistedFindingCount: number) {
  return resolveAuthoritativeGate({ computed, claim, persistedFindingCount });
}

describe('resolveAuthoritativeGate', () => {
  it('uses the server computation when the client claims nothing', () => {
    expect(resolve({}, 3)).toEqual({ shipScore: 84, verdict: 'review', source: 'server' });
    expect(resolve({ shipScore: null, verdict: null }, 3)).toEqual({
      shipScore: 84,
      verdict: 'review',
      source: 'server',
    });
  });

  it('treats a claim identical to the computation as the server result, with nothing to report', () => {
    expect(resolve({ shipScore: 84, verdict: 'review' }, 3)).toEqual({
      shipScore: 84,
      verdict: 'review',
      source: 'server',
    });
  });

  it('rejects a claim better than the persisted findings prove', () => {
    const gate = resolve({ shipScore: 100, verdict: 'ready' }, 3);
    expect(gate.shipScore).toBe(84);
    expect(gate.verdict).toBe('review');
    expect(gate.source).toBe('server');
    expect(gate.rejectedClaim).toEqual({
      shipScore: 100,
      verdict: 'ready',
      reason: 'better-than-evidence',
    });
  });

  it('rejects a claim that differs when nothing was truncated — same inputs must give the same gate', () => {
    // 3 findings persisted, 3 findings scored: a lower number is a drift, not evidence.
    const gate = resolve({ shipScore: 60, verdict: 'review' }, 3);
    expect(gate.shipScore).toBe(84);
    expect(gate.source).toBe('server');
    expect(gate.rejectedClaim?.reason).toBe('differs-without-truncation');
  });

  it('accepts a worse claim when the persisted slice is truncated', () => {
    // 100 of 240 findings persisted: the other 140 can only lower the score.
    const gate = resolve({ shipScore: 41, verdict: 'blocked' }, PERSISTED_FINDINGS_LIMIT);
    expect(gate).toEqual({ shipScore: 41, verdict: 'blocked', source: 'client' });
  });

  it('accepts a truncated claim that keeps the verdict and only lowers the score', () => {
    expect(resolve({ shipScore: 70, verdict: 'review' }, PERSISTED_FINDINGS_LIMIT)).toEqual({
      shipScore: 70,
      verdict: 'review',
      source: 'client',
    });
  });

  it('still rejects a better claim when the slice is truncated', () => {
    const gate = resolve({ shipScore: 91, verdict: 'ready' }, PERSISTED_FINDINGS_LIMIT);
    expect(gate.shipScore).toBe(84);
    expect(gate.verdict).toBe('review');
    expect(gate.rejectedClaim?.reason).toBe('better-than-evidence');
  });

  it('rejects an inconsistent pair — a lower score with a better verdict', () => {
    const gate = resolve({ shipScore: 50, verdict: 'ready' }, PERSISTED_FINDINGS_LIMIT);
    expect(gate.source).toBe('server');
    expect(gate.rejectedClaim?.reason).toBe('better-than-evidence');
  });

  it('completes a partial claim from the computation before judging it', () => {
    expect(resolve({ shipScore: 70 }, PERSISTED_FINDINGS_LIMIT)).toEqual({
      shipScore: 70,
      verdict: 'review',
      source: 'client',
    });
    expect(resolve({ verdict: 'blocked' }, PERSISTED_FINDINGS_LIMIT)).toEqual({
      shipScore: 84,
      verdict: 'blocked',
      source: 'client',
    });
  });

  it('ignores a "failed" verdict claim — a failed scan has no gate, the caller handles it', () => {
    expect(resolve({ shipScore: 0, verdict: 'failed' }, 3).rejectedClaim?.reason).toBe(
      'differs-without-truncation',
    );
    expect(resolve({ verdict: 'failed' }, 3)).toEqual({
      shipScore: 84,
      verdict: 'review',
      source: 'server',
    });
  });

  it('never returns a score outside 0–100 or a failed verdict', () => {
    const gate = resolve({ shipScore: 0, verdict: 'blocked' }, PERSISTED_FINDINGS_LIMIT);
    expect(gate.shipScore).toBeGreaterThanOrEqual(0);
    expect(gate.verdict).not.toBe('failed');
  });
});
