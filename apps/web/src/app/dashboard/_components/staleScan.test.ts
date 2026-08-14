import { describe, expect, it } from 'vitest';
import type { TargetCard } from '../../../utils/clientApi';
import {
  STALE_SCAN_DAYS,
  canRescanVerdictCard,
  isScanStale,
  isUuidTargetId,
  rescanActionLabel,
} from './staleScan';

const now = new Date('2026-07-31T12:00:00.000Z').getTime();

function card(overrides: Partial<TargetCard> = {}): TargetCard {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'repo',
    identifier: 'acme/api',
    displayName: 'acme/api',
    repositoryId: 'repo-1',
    generatorFingerprint: null,
    verdict: 'ready',
    shipScore: 100,
    topIssue: null,
    lastCheckedAt: '2026-07-30T12:00:00.000Z',
    latestScanId: 'scan-1',
    ownershipVerified: false,
    guardianEnabled: true,
    scoreDropped: false,
    badgeToken: null,
    scanCapability: 'browser',
    ...overrides,
  };
}

describe('canRescanVerdictCard capability gates', () => {
  it('blocks Scan now for cli_only and invalid repos', () => {
    expect(canRescanVerdictCard(card({ scanCapability: 'cli_only' }))).toBe(false);
    expect(canRescanVerdictCard(card({ scanCapability: 'invalid' }))).toBe(false);
    expect(canRescanVerdictCard(card({ scanCapability: 'browser' }))).toBe(true);
  });
});

describe('isScanStale', () => {
  it('treats never-scanned and invalid timestamps as stale', () => {
    expect(isScanStale(null, now)).toBe(true);
    expect(isScanStale('not-a-date', now)).toBe(true);
  });

  it(`marks checks older than ${STALE_SCAN_DAYS} days as stale`, () => {
    expect(isScanStale('2026-07-24T12:00:00.000Z', now)).toBe(true);
    expect(isScanStale('2026-06-24T12:00:00.000Z', now)).toBe(true);
  });

  it(`keeps checks within ${STALE_SCAN_DAYS} days fresh`, () => {
    expect(isScanStale('2026-07-24T12:00:01.000Z', now)).toBe(false);
    expect(isScanStale('2026-07-30T12:00:00.000Z', now)).toBe(false);
  });
});

describe('canRescanVerdictCard', () => {
  it('allows repo cards with a repository id', () => {
    expect(canRescanVerdictCard(card())).toBe(true);
    expect(canRescanVerdictCard(card({ repositoryId: null }))).toBe(false);
  });

  it('allows only ownership-verified URL targets with a real UUID id', () => {
    expect(
      canRescanVerdictCard(
        card({
          kind: 'url',
          repositoryId: null,
          ownershipVerified: true,
          id: '22222222-2222-4222-8222-222222222222',
        }),
      ),
    ).toBe(true);
    expect(
      canRescanVerdictCard(
        card({
          kind: 'url',
          repositoryId: null,
          ownershipVerified: false,
          id: '22222222-2222-4222-8222-222222222222',
        }),
      ),
    ).toBe(false);
    expect(
      canRescanVerdictCard(
        card({ kind: 'url', repositoryId: null, ownershipVerified: true, id: 'repo:abc' }),
      ),
    ).toBe(false);
  });
});

describe('helpers', () => {
  it('detects UUID target ids', () => {
    expect(isUuidTargetId('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isUuidTargetId('repo:11111111-1111-4111-8111-111111111111')).toBe(false);
  });

  it('labels first scan vs rescan', () => {
    expect(rescanActionLabel(null)).toBe('Scan now');
    expect(rescanActionLabel('2026-06-01T00:00:00.000Z')).toBe('Rescan');
  });
});
