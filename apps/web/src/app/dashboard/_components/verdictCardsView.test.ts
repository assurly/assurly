// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import type { TargetCard } from '../../../utils/clientApi';
import {
  countByVerdict,
  coverageLabelForCard,
  filterCardsByVerdict,
  isBrowserUnscannedCard,
  readVerdictCardsPrefs,
  VERDICT_CARDS_PREFS_KEY,
  writeVerdictCardsPrefs,
} from './verdictCardsView';

const memoryStore = new Map<string, string>();

beforeEach(() => {
  memoryStore.clear();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string): string | null => memoryStore.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        memoryStore.set(key, value);
      },
      removeItem: (key: string): void => {
        memoryStore.delete(key);
      },
    },
  });
});

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
    lastScanFailed: partial.lastScanFailed ?? false,
    lastScanFailureReason: partial.lastScanFailureReason ?? null,
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

describe('Verdict cards view prefs', () => {
  it('round-trips density, sort, and filters', () => {
    const prefs = {
      density: 'compact' as const,
      sort: 'name' as const,
      kindFilter: 'repos' as const,
      verdictFilter: 'blocked' as const,
    };
    writeVerdictCardsPrefs(prefs);
    expect(readVerdictCardsPrefs()).toEqual(prefs);
  });

  it('returns defaults for invalid JSON', () => {
    window.localStorage.setItem(VERDICT_CARDS_PREFS_KEY, '{not-json');
    expect(readVerdictCardsPrefs()).toEqual({
      density: 'comfortable',
      sort: 'urgency',
      kindFilter: 'all',
      verdictFilter: 'all',
    });
  });

  it('defaults missing filters to all', () => {
    window.localStorage.setItem(
      VERDICT_CARDS_PREFS_KEY,
      JSON.stringify({ density: 'compact', sort: 'name' }),
    );
    expect(readVerdictCardsPrefs()).toEqual({
      density: 'compact',
      sort: 'name',
      kindFilter: 'all',
      verdictFilter: 'all',
    });
  });
});
