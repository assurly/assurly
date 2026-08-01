// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScanWorkspace } from './ScanWorkspace';

afterEach(() => {
  cleanup();
});

const baseProps = {
  selectedRepoScanCount: 0,
  canJumpToScanResults: false,
  onJumpToResults: vi.fn(),
  isScanning: false,
  onRunScan: vi.fn(),
  scanError: null,
  onDismissScanError: vi.fn(),
  scanProgress: 0,
  scanLogs: [] as string[],
  repoDetailStatus: 'empty' as const,
  displayedScans: [],
  selectedScan: null,
  onSelectScan: vi.fn(),
  onDeleteScan: vi.fn(),
  deleteScanError: null,
  shipGateReport: null,
  fixSummary: null,
  displayedFindings: [],
  findingsLimit: 10,
  fetchTrend: vi.fn().mockResolvedValue({ points: [] }),
  selectedShareUrl: null,
  selectedBadgeMarkdown: null,
  onShare: vi.fn(),
  isSharing: false,
  shareError: null,
  fixingFindingId: null,
  isFindingFixable: () => false,
  onCreateFixPr: vi.fn(),
  onCreateBatchFixPr: vi.fn(),
};

describe('ScanWorkspace empty state', () => {
  it('uses viewport-agnostic copy when no repository is selected', () => {
    render(<ScanWorkspace {...baseProps} selectedRepo={null} />);

    expect(screen.getByText('No repository selected')).toBeTruthy();
    expect(screen.getByText(/Select a repository to run code analysis/i)).toBeTruthy();
    expect(screen.queryByText(/left panel/i)).toBeNull();
  });
});

describe('ScanWorkspace CTA hierarchy', () => {
  it('marks Run secure scan as the primary CTA', () => {
    render(
      <ScanWorkspace
        {...baseProps}
        selectedRepo={{
          id: 'repo-1',
          name: 'acme/api',
          organization_id: 'org-1',
          github_repo_id: 1,
          is_active: true,
          created_at: '2026-01-01T00:00:00.000Z',
        }}
        githubInstallationId="1"
      />,
    );

    const runScan = screen.getByRole('button', { name: /run secure scan/i });
    expect(runScan.className).toContain('dashboard-scan-action-btn--primary');
    expect(runScan.getAttribute('data-cta')).toBe('primary');
  });
});
