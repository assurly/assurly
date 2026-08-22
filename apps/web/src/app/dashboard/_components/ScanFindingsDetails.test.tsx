// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatFindingsDetailsSummary, ScanFindingsDetails } from './ScanFindingsDetails';
import type { ScanFinding } from '../../../utils/dbAdapter';

const findings: ScanFinding[] = [
  {
    id: 'finding-1',
    scan_id: 'scan-1',
    rule_id: 'supabase-rls',
    severity: 'error',
    file_path: 'schema.sql',
    line_number: 1,
    message: "Supabase table 'users' is created but Row-Level Security (RLS) is not enabled.",
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

afterEach(() => {
  cleanup();
});

describe('ScanFindingsDetails', () => {
  it('formats the collapsed summary label', () => {
    expect(formatFindingsDetailsSummary(1)).toBe('1 finding');
    expect(formatFindingsDetailsSummary(2)).toBe('2 findings');
  });

  it('keeps detailed findings collapsed by default', () => {
    render(
      <ScanFindingsDetails
        findings={findings}
        findingsLimit={100}
        fixingFindingId={null}
        isFindingFixable={() => false}
        onCreateFixPr={vi.fn()}
      />,
    );

    const details = screen.getByTestId('scan-details-findings') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(screen.getByText('2 findings')).toBeTruthy();
    expect(screen.getByText('View details')).toBeTruthy();
    expect(
      screen
        .getByTestId('scan-findings-details-toggle')
        .querySelector('.scan-findings-details__chevron'),
    ).toBeTruthy();
  });

  it('reveals finding cards after expanding details', () => {
    render(
      <ScanFindingsDetails
        findings={findings}
        findingsLimit={100}
        fixingFindingId={null}
        isFindingFixable={() => false}
        onCreateFixPr={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('scan-findings-details-toggle'));

    expect((screen.getByTestId('scan-details-findings') as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByTestId('scan-finding-card-finding-1')).toBeTruthy();
    expect(screen.getByTestId('scan-finding-card-finding-2')).toBeTruthy();
    expect(screen.getByText(findings[0]?.message ?? '')).toBeTruthy();
  });

  it('resets to collapsed when remounted with a new scan key', () => {
    const props = {
      findings,
      findingsLimit: 100,
      fixingFindingId: null,
      isFindingFixable: () => false,
      onCreateFixPr: vi.fn(),
    };

    const { rerender } = render(<ScanFindingsDetails key="scan-a" {...props} />);

    fireEvent.click(screen.getByTestId('scan-findings-details-toggle'));
    expect((screen.getByTestId('scan-details-findings') as HTMLDetailsElement).open).toBe(true);

    rerender(<ScanFindingsDetails key="scan-b" {...props} />);

    expect((screen.getByTestId('scan-details-findings') as HTMLDetailsElement).open).toBe(false);
  });

  it('deduplicates repeated env findings into one card with an occurrence badge', () => {
    const duplicateEnvFindings: ScanFinding[] = [
      {
        id: 'finding-a',
        scan_id: 'scan-1',
        rule_id: 'undocumented-env',
        severity: 'warning',
        file_path: 'src/a.ts',
        line_number: 1,
        message:
          "Environment variable 'process.env.NEXT_PUBLIC_SENTRY_DSN' is used but not documented in '.env.example'.",
        created_at: '2026-06-26T09:52:00Z',
      },
      {
        id: 'finding-b',
        scan_id: 'scan-1',
        rule_id: 'undocumented-env',
        severity: 'warning',
        file_path: 'src/b.ts',
        line_number: 2,
        message:
          "Environment variable 'process.env.NEXT_PUBLIC_SENTRY_DSN' is used but not documented in '.env.example'.",
        created_at: '2026-06-26T09:52:00Z',
      },
      {
        id: 'finding-c',
        scan_id: 'scan-1',
        rule_id: 'undocumented-env',
        severity: 'warning',
        file_path: 'src/c.ts',
        line_number: 3,
        message:
          "Environment variable 'process.env.NEXT_PUBLIC_SENTRY_DSN' is used but not documented in '.env.example'.",
        created_at: '2026-06-26T09:52:00Z',
      },
    ];

    const onCreateFixPr = vi.fn();

    render(
      <ScanFindingsDetails
        findings={duplicateEnvFindings}
        findingsLimit={100}
        fixingFindingId={null}
        isFindingFixable={() => true}
        onCreateFixPr={onCreateFixPr}
      />,
    );

    expect(screen.getByText('3 findings')).toBeTruthy();

    fireEvent.click(screen.getByTestId('scan-findings-details-toggle'));

    expect(screen.getByTestId('scan-finding-card-finding-a')).toBeTruthy();
    expect(screen.queryByTestId('scan-finding-card-finding-b')).toBeNull();
    expect(screen.queryByTestId('scan-finding-card-finding-c')).toBeNull();
    expect(screen.getByTestId('scan-finding-occurrence-finding-a').textContent).toBe('×3');

    fireEvent.click(screen.getByRole('button', { name: /fix it/i }));
    expect(onCreateFixPr).toHaveBeenCalledWith(duplicateEnvFindings[0]);
  });

  it('shows a transparency note when findings exceed the persisted cap', () => {
    render(
      <ScanFindingsDetails
        findings={Array.from({ length: 121 }, (_, index) => ({
          ...findings[0]!,
          id: `finding-${index}`,
        }))}
        findingsLimit={100}
        fixingFindingId={null}
        isFindingFixable={() => false}
        onCreateFixPr={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('scan-findings-details-toggle'));

    const note = screen.getByRole('note');
    expect(note.textContent).toMatch(/Showing all 121 findings from this run/i);
    expect(note.textContent).toMatch(/first 100/i);
  });
});
