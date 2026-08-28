import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Scan } from './dbAdapter';
import {
  countVisibleScanHistory,
  excludeTooLargeFailedScans,
  formatCommitShaShort,
  formatScanDateTime,
  formatScanHistoryChipLabel,
  selectLatestScanPerCommit,
  sortScansNewestFirst,
  visibleScanHistory,
} from './scanHistoryDisplay';

function buildScan(overrides: Partial<Scan> & Pick<Scan, 'id'>): Scan {
  return {
    repository_id: 'repo-1',
    commit_sha: '669c0392ea81119689959fdbe63b05c3c95ce544',
    branch: 'main',
    status: 'failed',
    error_count: 1,
    warning_count: 0,
    created_at: '2026-06-26T08:55:00.000Z',
    ...overrides,
  };
}

describe('scanHistoryDisplay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shortens hex commit SHAs to seven characters', () => {
    expect(formatCommitShaShort('669c0392ea81119689959fdbe63b05c3c95ce544')).toBe('669c039');
    expect(formatCommitShaShort('deadbee')).toBe('deadbee');
    expect(formatCommitShaShort('not-a-sha')).toBe('not-a-sha');
  });

  it('formats scan timestamps as a compact local date and 24-hour time', () => {
    const iso = '2026-06-26T08:55:00.000Z';
    const date = new Date(iso);
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ] as const;
    const pad = (value: number): string => value.toString().padStart(2, '0');
    expect(formatScanDateTime(iso)).toBe(
      `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} · ${pad(date.getHours())}:${pad(date.getMinutes())}`,
    );
    expect(formatScanDateTime('invalid')).toBe('invalid');
  });

  it('builds scan history chip labels with commit, date, and time', () => {
    const scan = buildScan({ id: 'scan-1' });
    expect(formatScanHistoryChipLabel(scan)).toBe(
      `commit 669c039 · ${formatScanDateTime(scan.created_at)}`,
    );
  });

  it('sorts scans newest first, then by id when timestamps tie', () => {
    const scans = [
      buildScan({ id: 'scan-old', created_at: '2026-08-17T09:00:00.000Z' }),
      buildScan({ id: 'scan-tie-b', created_at: '2026-08-17T10:00:00.000Z' }),
      buildScan({ id: 'scan-tie-a', created_at: '2026-08-17T10:00:00.000Z' }),
      buildScan({ id: 'scan-new', created_at: '2026-08-17T11:00:00.000Z' }),
    ];
    expect(sortScansNewestFirst(scans).map((scan) => scan.id)).toEqual([
      'scan-new',
      'scan-tie-b',
      'scan-tie-a',
      'scan-old',
    ]);
  });

  it('keeps every scan of the same commit in the history rail, newest first', () => {
    const sharedSha = 'c8039c4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const scans = [
      buildScan({ id: 'scan-old', commit_sha: sharedSha, created_at: '2026-08-17T09:00:00.000Z' }),
      buildScan({ id: 'scan-new', commit_sha: sharedSha, created_at: '2026-08-17T10:00:00.000Z' }),
      buildScan({
        id: 'scan-other',
        commit_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        created_at: '2026-08-17T09:30:00.000Z',
      }),
    ];

    expect(visibleScanHistory(scans).map((scan) => scan.id)).toEqual([
      'scan-new',
      'scan-other',
      'scan-old',
    ]);
  });

  it('keeps only the newest scan per hex commit SHA for trend charts', () => {
    const sharedSha = 'c8039c4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const scans = [
      buildScan({ id: 'scan-new', commit_sha: sharedSha, created_at: '2026-08-17T10:00:00.000Z' }),
      buildScan({ id: 'scan-old', commit_sha: sharedSha, created_at: '2026-08-17T09:00:00.000Z' }),
      buildScan({
        id: 'scan-older',
        commit_sha: sharedSha.toUpperCase(),
        created_at: '2026-08-17T08:00:00.000Z',
      }),
      buildScan({
        id: 'scan-other',
        commit_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        created_at: '2026-08-17T09:30:00.000Z',
      }),
    ];

    expect(selectLatestScanPerCommit(scans).map((scan) => scan.id)).toEqual([
      'scan-new',
      'scan-other',
    ]);
  });

  it('collapses eight copies of the same SHA to one scan for trend charts', () => {
    const sha = 'c8039c4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const scans = Array.from({ length: 8 }, (_, index) =>
      buildScan({
        id: `scan-${index}`,
        commit_sha: sha,
        created_at: `2026-08-17T0${index}:00:00.000Z`,
      }),
    );

    expect(selectLatestScanPerCommit(scans)).toHaveLength(1);
    expect(selectLatestScanPerCommit(scans)[0]?.id).toBe('scan-7');
  });

  it('does not collapse unknown placeholder SHAs', () => {
    const scans = [
      buildScan({ id: 'u-1', commit_sha: 'unknown', created_at: '2026-08-17T10:00:00.000Z' }),
      buildScan({ id: 'u-2', commit_sha: 'unknown', created_at: '2026-08-17T11:00:00.000Z' }),
    ];
    expect(selectLatestScanPerCommit(scans).map((scan) => scan.id)).toEqual(['u-1', 'u-2']);
  });

  it('counts every saved scan so the header matches the history rail', () => {
    const sha = 'c8039c4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const scans = [
      buildScan({ id: 'scan-a', commit_sha: sha, created_at: '2026-08-17T10:00:00.000Z' }),
      buildScan({ id: 'scan-b', commit_sha: sha, created_at: '2026-08-17T11:00:00.000Z' }),
      buildScan({ id: 'scan-c', commit_sha: sha, created_at: '2026-08-17T12:00:00.000Z' }),
    ];
    expect(countVisibleScanHistory(scans)).toBe(3);
  });

  it('does not count too-large Instant Gate failures in the visible history total', () => {
    const scans = [
      buildScan({
        id: 'keep',
        commit_sha: '669c0392ea81119689959fdbe63b05c3c95ce544',
      }),
      buildScan({
        id: 'too-large',
        commit_sha: 'unknown',
        failure_reason: 'too_large',
      }),
    ];
    expect(countVisibleScanHistory(scans)).toBe(1);
  });

  it('drops too-large Instant Gate failures from the history rail', () => {
    const scans = [
      buildScan({
        id: 'keep',
        commit_sha: '669c0392ea81119689959fdbe63b05c3c95ce544',
        failure_reason: null,
      }),
      buildScan({
        id: 'too-large',
        commit_sha: 'unknown',
        failure_reason: 'too_large',
      }),
    ];
    expect(excludeTooLargeFailedScans(scans).map((scan) => scan.id)).toEqual(['keep']);
    expect(visibleScanHistory(scans).map((scan) => scan.id)).toEqual(['keep']);
  });
});
