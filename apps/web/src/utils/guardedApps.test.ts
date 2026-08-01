import { describe, expect, it } from 'vitest';
import { countGuardedApps, isListedUrlTarget } from './guardedApps';
import type { Target } from './dbAdapter';

function target(partial: Partial<Target> & Pick<Target, 'kind' | 'ownership_verified'>): Target {
  return {
    id: 't1',
    organization_id: 'org-1',
    identifier: 'https://example.com',
    display_name: null,
    repository_id: null,
    generator_fingerprint: null,
    ownership_method: null,
    current_verdict: null,
    current_ship_score: null,
    verdict_evidence: null,
    last_checked_at: null,
    badge_token: null,
    created_at: '2026-07-30T00:00:00.000Z',
    updated_at: '2026-07-30T00:00:00.000Z',
    ...partial,
  };
}

describe('isListedUrlTarget', () => {
  it('lists every URL target (explicit Guard creates the row; one-offs do not)', () => {
    expect(isListedUrlTarget(target({ kind: 'url', ownership_verified: true }))).toBe(true);
    expect(isListedUrlTarget(target({ kind: 'url', ownership_verified: false }))).toBe(true);
    expect(isListedUrlTarget(target({ kind: 'repo', ownership_verified: false }))).toBe(false);
  });
});

describe('countGuardedApps', () => {
  it('sums connected repos and URL targets', () => {
    expect(countGuardedApps({ repositoryCount: 2, urlTargetCount: 1 })).toBe(3);
    expect(countGuardedApps({ repositoryCount: 0, urlTargetCount: 0 })).toBe(0);
  });
});
