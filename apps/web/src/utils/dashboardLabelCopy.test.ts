import { describe, expect, it } from 'vitest';
import { formatFindingsDetailsSummary } from '../app/dashboard/_components/ScanFindingsDetails';
import { formatRepositoryScanCount } from '../app/dashboard/_components/RepoListPanel';
import { getShareReportButtonLabel } from '../app/_components/ship-gate/ShipGatePanel';
import { formatCommitShaShort, formatScanHistoryChipLabel } from './scanHistoryDisplay';
import type { Scan } from './dbAdapter';

const scan: Scan = {
  id: 'scan-1',
  repository_id: 'repo-1',
  commit_sha: '669c0392ea81119689959fdbe63b05c3c95ce544',
  branch: 'main',
  status: 'failed',
  error_count: 1,
  warning_count: 0,
  created_at: '2026-06-26T08:55:00.000Z',
};

describe('dashboard label copy', () => {
  it('formats repository scan count labels', () => {
    expect(formatRepositoryScanCount(0)).toBe('No scans');
    expect(formatRepositoryScanCount(1)).toBe('1 scan');
    expect(formatRepositoryScanCount(4)).toBe('4 scans');
  });

  it('formats findings detail summary labels', () => {
    expect(formatFindingsDetailsSummary(1)).toBe('1 finding');
    expect(formatFindingsDetailsSummary(3)).toBe('3 findings');
  });

  it('formats share report button labels by billing plan', () => {
    expect(getShareReportButtonLabel('pro', false)).toBe('Share report');
    expect(getShareReportButtonLabel('free', false)).toBe('Share report (Pro)');
    expect(getShareReportButtonLabel('pro', true)).toBe('Creating link…');
  });

  it('formats scan history chip copy', () => {
    expect(formatCommitShaShort(scan.commit_sha)).toBe('669c039');
    expect(formatScanHistoryChipLabel(scan)).toMatch(/^commit 669c039 · \d{2}:\d{2}$/);
  });
});
