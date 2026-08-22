// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildShipGateReport } from '@assurly/scanner-core';
import { isTooLargeScanError, ScanWorkspace } from './ScanWorkspace';

afterEach(() => {
  cleanup();
});

const sampleRepo = {
  id: 'repo-1',
  name: 'acme/api',
  organization_id: 'org-1',
  github_repo_id: 1,
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
};

const baseProps = {
  selectedRepoScanCount: 0,
  canJumpToScanResults: false,
  onJumpToResults: vi.fn(),
  isScanning: false,
  onRunScan: vi.fn(),
  onStopScan: vi.fn(),
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
    render(<ScanWorkspace {...baseProps} selectedRepo={sampleRepo} githubInstallationId="1" />);

    const runScan = screen.getByRole('button', { name: /run secure scan/i });
    expect(runScan.className).toContain('dashboard-scan-action-btn--primary');
    expect(runScan.getAttribute('data-cta')).toBe('primary');
    expect(screen.queryByRole('button', { name: /stop scan/i })).toBeNull();
  });

  it('shows Stop scan as a secondary action while Instant Gate is running', () => {
    const onStopScan = vi.fn();
    render(
      <ScanWorkspace
        {...baseProps}
        selectedRepo={sampleRepo}
        githubInstallationId="1"
        isScanning
        onStopScan={onStopScan}
      />,
    );

    const stop = screen.getByRole('button', { name: /stop scan/i });
    expect(stop.getAttribute('data-testid')).toBe('stop-scan');
    expect(stop.getAttribute('data-cta')).toBe('secondary');
    expect(stop.className).toContain('dashboard-scan-action-btn--secondary');
    fireEvent.click(stop);
    expect(onStopScan).toHaveBeenCalledTimes(1);
  });

  it('shows Full Gate empty state for cli_only repositories', () => {
    render(
      <ScanWorkspace
        {...baseProps}
        selectedRepo={{
          id: 'repo-large',
          name: 'vercel/next.js',
          organization_id: 'org-1',
          github_repo_id: 2,
          is_active: true,
          created_at: '2026-01-01T00:00:00.000Z',
          scan_capability: 'cli_only',
        }}
        githubInstallationId="1"
        repoDetailStatus="empty"
      />,
    );

    expect(screen.getByText(/Too large for Instant Gate/i)).toBeTruthy();
    expect(screen.getByTestId('full-gate-cli-command').textContent).toContain(
      'npx assurly scan --submit --repo vercel/next.js',
    );
    expect(screen.getAllByRole('button', { name: /copy full gate/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /run secure scan/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /stop scan/i })).toBeNull();
  });

  it('embeds a copyable Full Gate command in the too-large scan error panel', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <ScanWorkspace
        {...baseProps}
        selectedRepo={{
          id: 'repo-ai',
          name: 'vercel/ai',
          organization_id: 'org-1',
          github_repo_id: 3,
          is_active: true,
          created_at: '2026-01-01T00:00:00.000Z',
          scan_capability: 'cli_only',
        }}
        githubInstallationId="1"
        scanError="Failed to fetch repository tree: This repository is too large for the in-browser scan. Run `npx assurly scan` locally."
        repoDetailStatus="empty"
      />,
    );

    const errorPanel = screen.getByTestId('scan-error-panel');
    expect(errorPanel.className).toContain('dashboard-scan-error--cli');
    expect(screen.getByText('Too large for Instant Gate')).toBeTruthy();
    const cliBlock = screen.getByTestId('scan-error-full-gate');
    expect(cliBlock.textContent).toContain('npx assurly scan --submit --repo vercel/ai');
    expect(screen.queryByText(/Fix the issue above, then run the scan again/i)).toBeNull();

    fireEvent.click(cliBlock.querySelector('button') as HTMLButtonElement);
    expect(writeText).toHaveBeenCalledWith(
      'ASSURLY_API_KEY=ask_… npx assurly scan --submit --repo vercel/ai',
    );
  });
});

describe('ScanWorkspace loading header', () => {
  it('shows Loading scans instead of No scans while details load', () => {
    render(
      <ScanWorkspace
        {...baseProps}
        selectedRepo={sampleRepo}
        githubInstallationId="1"
        repoDetailStatus="loading"
      />,
    );

    expect(screen.getByText('Loading scans…')).toBeTruthy();
    expect(screen.queryByText('No scans')).toBeNull();
  });
});

describe('isTooLargeScanError', () => {
  it('detects Instant Gate size-limit failures', () => {
    expect(isTooLargeScanError('too large for the in-browser scan')).toBe(true);
    expect(isTooLargeScanError('Too large for Instant Gate')).toBe(true);
    expect(isTooLargeScanError('Network timeout')).toBe(false);
  });
});

describe('ScanWorkspace too-large vs empty Ship Gate', () => {
  it('does not render the empty-files Ship Gate hint beside the Too large panel', () => {
    render(
      <ScanWorkspace
        {...baseProps}
        selectedRepo={{
          ...sampleRepo,
          scan_capability: 'cli_only',
        }}
        githubInstallationId="1"
        scanError="This repository is too large for Instant Gate."
        repoDetailStatus="ready"
        selectedScan={{
          id: 'scan-unknown',
          repository_id: sampleRepo.id,
          commit_sha: 'unknown',
          branch: 'main',
          status: 'failed',
          error_count: 0,
          warning_count: 0,
          created_at: '2026-08-18T00:00:00.000Z',
          failure_reason: 'too_large',
        }}
        displayedScans={[
          {
            id: 'scan-unknown',
            repository_id: sampleRepo.id,
            commit_sha: 'unknown',
            branch: 'main',
            status: 'failed',
            error_count: 0,
            warning_count: 0,
            created_at: '2026-08-18T00:00:00.000Z',
            failure_reason: 'too_large',
          },
        ]}
        shipGateReport={buildShipGateReport([], { scannedFileCount: 0, cleanFileCount: 0 })}
      />,
    );

    expect(screen.getByText('Too large for Instant Gate')).toBeTruthy();
    expect(screen.queryByText(/No scannable application files/i)).toBeNull();
    expect(screen.queryByText(/commit unknown/i)).toBeNull();
    expect(screen.queryByTestId('scan-details-ship-gate')).toBeNull();
  });

  it('offers Scan main instead after an empty Instant Gate scan', () => {
    const onScanAlternateBranch = vi.fn();
    render(
      <ScanWorkspace
        {...baseProps}
        selectedRepo={sampleRepo}
        githubInstallationId="1"
        scanError="No scannable application files (JS/TS/SQL) were found."
        alternateScanBranches={['main', 'develop']}
        onScanAlternateBranch={onScanAlternateBranch}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Scan main instead/i }));
    expect(onScanAlternateBranch).toHaveBeenCalledWith('main');
  });
});
