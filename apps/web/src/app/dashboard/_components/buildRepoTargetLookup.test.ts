import { describe, expect, it } from 'vitest';
import type { TargetCard } from '../../../utils/clientApi';
import { buildRepoTargetLookup } from './buildRepoTargetLookup';

function card(partial: Partial<TargetCard> & Pick<TargetCard, 'id' | 'kind'>): TargetCard {
  return {
    identifier: partial.identifier ?? partial.id,
    displayName: partial.displayName ?? 'app',
    repositoryId: partial.repositoryId ?? null,
    generatorFingerprint: partial.generatorFingerprint ?? null,
    verdict: partial.verdict ?? 'ready',
    shipScore: partial.shipScore ?? 100,
    topIssue: partial.topIssue ?? null,
    lastCheckedAt: partial.lastCheckedAt ?? null,
    latestScanId: partial.latestScanId ?? null,
    ownershipVerified: partial.ownershipVerified ?? false,
    guardianEnabled: partial.guardianEnabled ?? false,
    scoreDropped: partial.scoreDropped ?? false,
    badgeToken: partial.badgeToken ?? null,
    scanCapability: partial.scanCapability ?? 'browser',
    ...partial,
  };
}

describe('buildRepoTargetLookup', () => {
  it('maps real UUID repo targets by repositoryId', () => {
    const repoId = '11111111-1111-4111-8111-111111111111';
    const targetId = '22222222-2222-4222-8222-222222222222';
    const lookup = buildRepoTargetLookup([
      card({ id: targetId, kind: 'repo', repositoryId: repoId }),
      card({
        id: 'repo:owner/name',
        kind: 'repo',
        repositoryId: '33333333-3333-4333-8333-333333333333',
      }),
      card({ id: '44444444-4444-4444-8444-444444444444', kind: 'url', repositoryId: null }),
    ]);

    expect(lookup).toEqual({ [repoId]: targetId });
  });

  it('returns an empty map when nothing is mappable', () => {
    expect(buildRepoTargetLookup([])).toEqual({});
  });
});
