import { describe, expect, it } from 'vitest';
import type { TargetCard } from '../../../utils/clientApi';
import {
  countByVerdict,
  coverageLabelForCard,
  filterCardsByVerdict,
  isBrowserUnscannedCard,
} from './verdictCardsView';

function card(partial: Partial<TargetCard> & Pick<TargetCard, 'id' | 'verdict'>): TargetCard {
  return {
    kind: 'repo',
    identifier: partial.identifier ?? partial.id,
    displayName: partial.displayName ?? partial.id,
    repositoryId: partial.repositoryId ?? partial.id,
    generatorFingerprint: null,
    shipScore: partial.shipScore ?? null,
    topIssue: null,
    lastCheckedAt: partial.lastCheckedAt ?? null,
    latestScanId: null,
    ownershipVerified: false,
    guardianEnabled: true,
    scoreDropped: false,
    badgeToken: null,
    scanCapability: partial.scanCapability ?? 'browser',
    ...partial,
  };
}

describe('Unscanned hygiene', () => {
  it('excludes cli_only and invalid repos from Unscanned filter/count', () => {
    const cards = [
      card({ id: 'a', verdict: 'unknown', scanCapability: 'browser' }),
      card({ id: 'b', verdict: 'unknown', scanCapability: 'cli_only' }),
      card({ id: 'c', verdict: 'unknown', scanCapability: 'invalid' }),
      card({ id: 'd', verdict: 'ready', shipScore: 100, scanCapability: 'browser' }),
    ];

    expect(filterCardsByVerdict(cards, 'unknown').map((item) => item.id)).toEqual(['a']);
    expect(countByVerdict(cards).unknown).toBe(1);
    expect(isBrowserUnscannedCard(cards[1]!)).toBe(false);
  });

  it('labels Instant incomplete vs Full Gate coverage honestly', () => {
    expect(
      coverageLabelForCard(
        card({
          id: 'incomplete',
          verdict: 'review',
          shipScore: 79,
          topIssue: {
            key: 'rule:scan-completeness',
            label: 'Incomplete scan',
            severity: 'warning',
            sampleMessage: 'Incomplete',
            affectedFileCount: 1,
            occurrenceCount: 1,
          },
        }),
      ),
    ).toBe('Instant · incomplete');
    expect(
      coverageLabelForCard(
        card({ id: 'cli', verdict: 'blocked', shipScore: 64, scanCapability: 'cli_only' }),
      ),
    ).toBe('Full Gate');
  });
});
