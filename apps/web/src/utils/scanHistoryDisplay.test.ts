import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Scan } from './dbAdapter';
import {
  buildDuplicateShaBadges,
  formatCommitShaShort,
  formatDuplicateShaBadge,
  formatScanHistoryChipLabel,
  formatScanTime,
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

  it('formats scan timestamps as pinned en-US 24-hour local time', () => {
    const iso = '2026-06-26T08:55:00.000Z';
    const expected = new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    expect(formatScanTime(iso)).toBe(expected);

    const spy = vi.spyOn(Date.prototype, 'toLocaleTimeString');
    formatScanTime(iso);
    expect(spy).toHaveBeenCalledWith('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    expect(formatScanTime('invalid')).toBe('invalid');
  });

  it('builds scan history chip labels with middle-dot separators', () => {
    const scan = buildScan({ id: 'scan-1' });
    expect(formatScanHistoryChipLabel(scan)).toMatch(/^commit 669c039 · \d{2}:\d{2}$/);
  });

  it('returns duplicate SHA badges only when a commit appears more than once', () => {
    const sharedSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const scans = [
      buildScan({ id: 'scan-1', commit_sha: sharedSha, created_at: '2026-06-26T08:00:00.000Z' }),
      buildScan({ id: 'scan-2', commit_sha: sharedSha, created_at: '2026-06-26T09:00:00.000Z' }),
      buildScan({ id: 'scan-3', commit_sha: sharedSha, created_at: '2026-06-26T10:00:00.000Z' }),
      buildScan({ id: 'scan-4', commit_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
    ];

    const badges = buildDuplicateShaBadges(scans);

    expect(badges.size).toBe(3);
    expect(badges.get('scan-1')).toEqual({ index: 1, total: 3 });
    expect(badges.get('scan-2')).toEqual({ index: 2, total: 3 });
    expect(badges.get('scan-3')).toEqual({ index: 3, total: 3 });
    expect(badges.has('scan-4')).toBe(false);
  });

  it('formats duplicate SHA badges for chip copy', () => {
    expect(formatDuplicateShaBadge({ index: 2, total: 6 })).toBe('#2 of 6');
  });
});
