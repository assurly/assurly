import { describe, expect, it } from 'vitest';
import type { TargetCard } from '../../../utils/clientApi';
import {
  filterCardsByKind,
  filterCardsByVerdict,
  shouldShowGuardianChip,
  sortVerdictCards,
} from './verdictCardsView';

function card(
  partial: Partial<TargetCard> & Pick<TargetCard, 'id' | 'kind' | 'verdict'>,
): TargetCard {
  return {
    identifier: partial.identifier ?? partial.id,
    displayName: partial.displayName ?? partial.id,
    repositoryId: partial.repositoryId ?? (partial.kind === 'repo' ? 'repo-1' : null),
    generatorFingerprint: partial.generatorFingerprint ?? null,
    shipScore: partial.shipScore ?? 96,
    topIssue: partial.topIssue ?? null,
    lastCheckedAt: partial.lastCheckedAt ?? null,
    latestScanId: partial.latestScanId ?? null,
    ownershipVerified: partial.ownershipVerified ?? false,
    guardianEnabled: partial.guardianEnabled ?? false,
    scoreDropped: partial.scoreDropped ?? false,
    badgeToken: partial.badgeToken ?? null,
    ...partial,
  };
}

describe('sortVerdictCards', () => {
  it('puts blockers first, then lower scores within the same verdict', () => {
    const cards = [
      card({
        id: 'ready-high',
        kind: 'repo',
        verdict: 'ready',
        shipScore: 96,
        displayName: 'z/app',
      }),
      card({
        id: 'blocked-high',
        kind: 'repo',
        verdict: 'blocked',
        shipScore: 80,
        displayName: 'a/api',
      }),
      card({
        id: 'blocked-low',
        kind: 'repo',
        verdict: 'blocked',
        shipScore: 40,
        displayName: 'b/api',
      }),
      card({
        id: 'review',
        kind: 'url',
        verdict: 'review',
        shipScore: 92,
        displayName: 'https://r.app',
      }),
    ];

    const sorted = sortVerdictCards(cards, 'urgency').map((entry) => entry.id);
    expect(sorted).toEqual(['blocked-low', 'blocked-high', 'review', 'ready-high']);
  });

  it('sorts by score ascending with missing scores last', () => {
    const cards = [
      card({ id: 'null', kind: 'repo', verdict: 'unknown', shipScore: null }),
      card({ id: 'high', kind: 'repo', verdict: 'ready', shipScore: 96 }),
      card({ id: 'low', kind: 'repo', verdict: 'blocked', shipScore: 40 }),
    ];
    expect(sortVerdictCards(cards, 'score-asc').map((entry) => entry.id)).toEqual([
      'low',
      'high',
      'null',
    ]);
  });
});

describe('filterCardsByVerdict / filterCardsByKind', () => {
  const cards = [
    card({ id: 'r1', kind: 'repo', verdict: 'blocked' }),
    card({ id: 'u1', kind: 'url', verdict: 'ready', displayName: 'https://ok.app' }),
    card({ id: 'r2', kind: 'repo', verdict: 'ready' }),
  ];

  it('filters by verdict', () => {
    expect(filterCardsByVerdict(cards, 'ready').map((c) => c.id)).toEqual(['u1', 'r2']);
    expect(filterCardsByVerdict(cards, 'blocked').map((c) => c.id)).toEqual(['r1']);
  });

  it('filters by kind', () => {
    expect(filterCardsByKind(cards, 'urls').map((c) => c.id)).toEqual(['u1']);
    expect(filterCardsByKind(cards, 'repos').map((c) => c.id)).toEqual(['r1', 'r2']);
  });
});

describe('shouldShowGuardianChip', () => {
  it('hides Guardian on repos to avoid badge fatigue', () => {
    expect(
      shouldShowGuardianChip(
        card({ id: 'r1', kind: 'repo', verdict: 'ready', guardianEnabled: true }),
      ),
    ).toBe(false);
  });

  it('shows Guardian only for guarded URLs', () => {
    expect(
      shouldShowGuardianChip(
        card({
          id: 'u1',
          kind: 'url',
          verdict: 'ready',
          guardianEnabled: true,
          ownershipVerified: true,
        }),
      ),
    ).toBe(true);
    expect(
      shouldShowGuardianChip(
        card({
          id: 'u2',
          kind: 'url',
          verdict: 'ready',
          guardianEnabled: false,
        }),
      ),
    ).toBe(false);
  });
});
