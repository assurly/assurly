// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import type { TargetCard } from '../../../utils/clientApi';
import {
  countByVerdict,
  coverageLabelForCard,
  filterCardsByVerdict,
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

describe('verdict filters partition the cards', () => {
  // Every card must be reachable through exactly one verdict chip, and the four
  // chip counts must add up to "All". Capability (browser / cli_only / invalid)
  // is how a card gets scanned, not whether it has a verdict — it belongs on
  // the card's coverage label, never in the bucket. This regressed once: three
  // cli_only repos with no verdict fell out of every chip and All showed 25
  // while the chips summed to 22.
  const cards = [
    card({ id: 'blocked-browser', verdict: 'blocked', shipScore: 40 }),
    card({ id: 'review-browser', verdict: 'review', shipScore: 80 }),
    card({ id: 'review-cli', verdict: 'review', shipScore: 84, scanCapability: 'cli_only' }),
    card({ id: 'ready-browser', verdict: 'ready', shipScore: 100 }),
    card({ id: 'unscanned-browser', verdict: 'unknown' }),
    card({ id: 'unscanned-failed', verdict: 'unknown', lastScanFailed: true }),
    card({ id: 'unscanned-cli', verdict: 'unknown', scanCapability: 'cli_only' }),
    card({ id: 'unscanned-invalid', verdict: 'unknown', scanCapability: 'invalid' }),
  ];

  it('counts every card in exactly one bucket, so the chips add up to All', () => {
    const counts = countByVerdict(cards);
    expect(counts).toEqual({ blocked: 1, review: 2, ready: 1, unknown: 4 });
    expect(counts.blocked + counts.review + counts.ready + counts.unknown).toBe(cards.length);
  });

  it('reaches a cli_only or invalid repo with no verdict through the Unscanned chip', () => {
    expect(filterCardsByVerdict(cards, 'unknown').map((item) => item.id)).toEqual([
      'unscanned-browser',
      'unscanned-failed',
      'unscanned-cli',
      'unscanned-invalid',
    ]);
  });

  it('keeps a cli_only repo that submitted a Full Gate verdict in its verdict bucket', () => {
    expect(filterCardsByVerdict(cards, 'review').map((item) => item.id)).toEqual([
      'review-browser',
      'review-cli',
    ]);
  });

  it('filters and counts agree for every chip', () => {
    const counts = countByVerdict(cards);
    for (const filter of ['blocked', 'review', 'ready', 'unknown'] as const) {
      expect(filterCardsByVerdict(cards, filter)).toHaveLength(counts[filter]);
    }
    expect(filterCardsByVerdict(cards, 'all')).toHaveLength(cards.length);
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
