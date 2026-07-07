// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getScanDetailsSectionOrder,
  SCAN_DETAILS_SECTION_ORDER,
  ScanDetailsPanel,
  type ScanDetailsPanelProps,
} from './ScanDetailsPanel';
import type { Scan, ScanFinding } from '../../../utils/dbAdapter';
import { buildShipGateFromScanFindings } from '../../../utils/shipGate';

const selectedScan: Scan = {
  id: 'scan-1',
  repository_id: 'repo-1',
  commit_sha: '189ea22052abcdef',
  branch: 'main',
  status: 'failed',
  error_count: 1,
  warning_count: 1,
  created_at: '2026-06-26T09:52:00Z',
};

const findings: ScanFinding[] = [
  {
    id: 'finding-1',
    scan_id: 'scan-1',
    rule_id: 'supabase-rls',
    severity: 'error',
    file_path: 'schema.sql',
    line_number: 1,
    message: "Supabase table 'users' is created but Row-Level Security (RLS) is not enabled.",
    suggestion: 'Enable RLS on the table.',
    created_at: '2026-06-26T09:52:00Z',
  },
  {
    id: 'finding-2',
    scan_id: 'scan-1',
    rule_id: 'github-actions-integration',
    severity: 'warning',
    file_path: 'Global Configs',
    line_number: 1,
    message: 'GitHub Actions workflow for Assurly is missing.',
    created_at: '2026-06-26T09:52:00Z',
  },
];

function buildProps(overrides: Partial<ScanDetailsPanelProps> = {}): ScanDetailsPanelProps {
  return {
    selectedScan,
    shipGateReport: buildShipGateFromScanFindings(findings, {
      scannedFileCount: 12,
      cleanFileCount: 10,
    }),
    fixSummary: {
      issueCount: 1,
      fixableCount: 1,
      proposedCount: 0,
      remainingCount: 1,
      sharedBatchPrUrl: null,
    },
    displayedFindings: findings,
    fixingFindingId: null,
    isFindingFixable: () => true,
    onCreateFixPr: vi.fn(),
    onCreateBatchFixPr: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('ScanDetailsPanel information architecture', () => {
  it('renders Ship Gate before fix summary and detailed findings', () => {
    render(<ScanDetailsPanel {...buildProps()} />);

    const container = screen.getByTestId('scan-details-container');
    expect(getScanDetailsSectionOrder(container)).toEqual([
      'ship-gate',
      'commit',
      'fix-summary',
      'findings',
    ]);
  });

  it('places Ship Gate ahead of upstream/fix metrics in the DOM', () => {
    render(<ScanDetailsPanel {...buildProps()} />);

    const shipGate = screen.getByTestId('scan-details-ship-gate');
    const fixSummary = screen.getByTestId('scan-details-fix-summary');
    const findingsSection = screen.getByTestId('scan-details-findings');

    expect(
      shipGate.compareDocumentPosition(fixSummary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      fixSummary.compareDocumentPosition(findingsSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows the Ship Gate hero verdict before commit metadata', () => {
    render(<ScanDetailsPanel {...buildProps()} />);

    const order = getScanDetailsSectionOrder(screen.getByTestId('scan-details-container'));
    expect(order.indexOf('ship-gate')).toBeLessThan(order.indexOf('commit'));
    expect(screen.getByText('NOT READY TO SHIP')).toBeTruthy();
    expect(screen.getByText(/Commit SHA:/i)).toBeTruthy();
  });

  it('shows a warning action directly inside the Ship Gate panel', () => {
    render(<ScanDetailsPanel {...buildProps()} />);

    expect(screen.getByText('Initialize CI workflow')).toBeTruthy();
    expect(screen.getByText('npx assurly init')).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy command/i })).toBeTruthy();
  });

  it('forwards billingPlan to the Ship Gate share button copy', () => {
    render(
      <ScanDetailsPanel
        {...buildProps({
          billingPlan: 'pro',
          onShare: vi.fn(),
        })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Share report' })).toBeTruthy();
  });

  it('collapses detailed findings behind a Show details control', () => {
    render(<ScanDetailsPanel {...buildProps()} />);

    expect(screen.getByText('Show details · 2 findings')).toBeTruthy();
    expect((screen.getByTestId('scan-details-findings') as HTMLDetailsElement).open).toBe(false);

    fireEvent.click(screen.getByTestId('scan-findings-details-toggle'));

    expect((screen.getByTestId('scan-details-findings') as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByTestId('scan-finding-card-finding-1')).toBeTruthy();
    expect(screen.getByText(findings[0]?.message ?? '')).toBeTruthy();
  });

  it('collapses detailed findings when the selected scan changes', () => {
    const scanA: Scan = { ...selectedScan, id: 'scan-a' };
    const scanB: Scan = { ...selectedScan, id: 'scan-b', commit_sha: 'bbbbbbbbbbbbbbbb' };

    const { rerender } = render(<ScanDetailsPanel {...buildProps({ selectedScan: scanA })} />);

    fireEvent.click(screen.getByTestId('scan-findings-details-toggle'));
    expect((screen.getByTestId('scan-details-findings') as HTMLDetailsElement).open).toBe(true);

    rerender(<ScanDetailsPanel {...buildProps({ selectedScan: scanB })} />);

    expect((screen.getByTestId('scan-details-findings') as HTMLDetailsElement).open).toBe(false);
  });

  it('omits fix summary when there are no issues to action', () => {
    render(
      <ScanDetailsPanel
        {...buildProps({
          fixSummary: {
            issueCount: 0,
            fixableCount: 0,
            proposedCount: 0,
            remainingCount: 0,
            sharedBatchPrUrl: null,
          },
          displayedFindings: [],
          shipGateReport: buildShipGateFromScanFindings([], {
            scannedFileCount: 5,
            cleanFileCount: 5,
          }),
        })}
      />,
    );

    const order = getScanDetailsSectionOrder(screen.getByTestId('scan-details-container'));
    expect(order).toEqual(['ship-gate', 'commit']);
    expect(screen.queryByTestId('scan-details-fix-summary')).toBeNull();
    expect(screen.getByText('READY TO SHIP')).toBeTruthy();
  });

  it('documents the canonical section order contract', () => {
    expect(SCAN_DETAILS_SECTION_ORDER).toEqual(['ship-gate', 'commit', 'fix-summary', 'findings']);
  });

  it('copies the fix prompt to the clipboard and shows a toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(<ScanDetailsPanel {...buildProps()} />);

    fireEvent.click(screen.getByTestId('scan-copy-fix-prompt'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(writeText.mock.calls[0]?.[0]).toContain('Assurly fix prompt');
    expect(screen.getByText('Fix prompt copied to clipboard.')).toBeTruthy();
  });
});
