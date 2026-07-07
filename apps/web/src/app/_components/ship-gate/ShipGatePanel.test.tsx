// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShipGatePanel, getShareReportButtonLabel } from './ShipGatePanel';
import { buildShipGateReport } from '@assurly/scanner-core';

const writeText = vi.fn().mockResolvedValue(undefined);

afterEach(() => {
  cleanup();
  writeText.mockClear();
});

describe('ShipGatePanel warning actions', () => {
  it('renders Initialize CI workflow prominently with a copyable command under warnings', () => {
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const report = buildShipGateReport(
      [
        {
          ruleId: 'github-actions-integration',
          severity: 'warning',
          file: 'Global Configs',
          line: 1,
          message: 'GitHub Actions workflow for Assurly is missing.',
          suggestion:
            'Run "npx assurly init" in your repository to automatically configure the CI/CD pipeline.',
        },
      ],
      { scannedFileCount: 12, cleanFileCount: 11 },
    );

    render(<ShipGatePanel report={report} />);

    expect(screen.getByText('GitHub Actions workflow for Assurly is missing.')).toBeTruthy();
    expect(screen.getByText('Initialize CI workflow')).toBeTruthy();
    expect(screen.queryByText('Run locally')).toBeNull();
    expect(screen.getByText('npx assurly init')).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy command/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /copy command/i }));
    expect(writeText).toHaveBeenCalledWith('npx assurly init');
  });

  it('renders a hint action directly under a blocker row', () => {
    const report = buildShipGateReport(
      [
        {
          ruleId: 'supabase-rls',
          severity: 'error',
          file: 'schema.sql',
          line: 1,
          message: "Supabase table 'users' is created but Row-Level Security (RLS) is not enabled.",
          suggestion: 'Enable RLS on the table.',
        },
      ],
      { scannedFileCount: 4, cleanFileCount: 3 },
    );

    render(<ShipGatePanel report={report} />);

    expect(screen.getByText('Missing RLS on table: users')).toBeTruthy();
    expect(screen.getByText('Enable RLS on the table.')).toBeTruthy();
  });
});

describe('ShipGatePanel blocker label layout', () => {
  it('renders full env blocker labels alongside file meta without truncating the variable name', () => {
    const report = buildShipGateReport(
      [
        {
          ruleId: 'undocumented-env',
          severity: 'error',
          file: 'src/config.ts',
          line: 4,
          message:
            "Environment variable 'process.env.NEXT_PUBLIC_SENTRY_DSN' is used but not documented in '.env.example'.",
        },
      ],
      { scannedFileCount: 8, cleanFileCount: 7 },
    );

    const { container } = render(
      <div className="scan-details-container" data-testid="scan-details-container">
        <ShipGatePanel report={report} />
      </div>,
    );

    expect(screen.getByText('Undocumented env: NEXT_PUBLIC_SENTRY_DSN')).toBeTruthy();
    expect(screen.getByText('→ 1 file')).toBeTruthy();

    const label = container.querySelector('.ship-gate-list-label');
    const meta = container.querySelector('.ship-gate-list-meta');

    expect(label?.textContent).toContain('NEXT_PUBLIC_SENTRY_DSN');
    expect(meta?.textContent).toBe('→ 1 file');
    expect(label!.compareDocumentPosition(meta!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('ShipGatePanel share button copy', () => {
  const readyReport = buildShipGateReport([], { scannedFileCount: 1, cleanFileCount: 1 });

  it('formats share button labels by billing plan', () => {
    expect(getShareReportButtonLabel('pro', false)).toBe('Share report');
    expect(getShareReportButtonLabel('free', false)).toBe('Share report (Pro)');
    expect(getShareReportButtonLabel('agency', false)).toBe('Share report (Pro)');
    expect(getShareReportButtonLabel(undefined, false)).toBe('Share report (Pro)');
    expect(getShareReportButtonLabel('pro', true)).toBe('Creating link…');
  });

  it('shows Share report for Pro users with an active share action', () => {
    render(<ShipGatePanel report={readyReport} billingPlan="pro" onShare={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Share report' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share report (Pro)' })).toBeNull();
  });

  it('shows Share report (Pro) for free users with an active share action', () => {
    render(<ShipGatePanel report={readyReport} billingPlan="free" onShare={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Share report (Pro)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Share report$/i })).toBeNull();
  });

  it('shows a pending label while a share link is being created', () => {
    render(
      <ShipGatePanel report={readyReport} billingPlan="pro" onShare={vi.fn()} isSharing={true} />,
    );

    expect(screen.getByRole('button', { name: 'Creating link…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Creating link…' }).getAttribute('aria-busy')).toBe(
      'true',
    );
  });
});

describe('ShipGatePanel redactFindings', () => {
  const blockedReport = buildShipGateReport(
    [
      {
        ruleId: 'runtime-supabase-rls-open',
        severity: 'error',
        file: 'Supabase REST API',
        message: "Supabase table 'profiles' returned rows via anon key without RLS protection.",
        suggestion: "Enable row-level security and add policies for table 'profiles'.",
      },
    ],
    { scannedFileCount: 1, cleanFileCount: 0 },
  );
  const cleanReport = buildShipGateReport([], { scannedFileCount: 1, cleanFileCount: 1 });

  it('renders the full findings list when redactFindings is not set', () => {
    render(<ShipGatePanel report={blockedReport} />);

    expect(screen.getByText(/Supabase table 'profiles' returned rows via anon key/)).toBeTruthy();
    expect(screen.queryByTestId('ship-gate-redacted-hint')).toBeNull();
  });

  it('hides the findings details when redactFindings is true, keeping the verdict visible', () => {
    render(<ShipGatePanel report={blockedReport} redactFindings />);

    expect(screen.getByText('NOT READY TO SHIP')).toBeTruthy();
    expect(screen.getByLabelText(/Ship score \d+ out of 100/)).toBeTruthy();
    expect(screen.queryByText(/Supabase table 'profiles' returned rows via anon key/)).toBeNull();
    expect(screen.getByTestId('ship-gate-redacted-hint')).toBeTruthy();
  });

  it('does not render the redacted hint when there is nothing to redact', () => {
    render(<ShipGatePanel report={cleanReport} redactFindings />);
    expect(screen.queryByTestId('ship-gate-redacted-hint')).toBeNull();
  });
});
