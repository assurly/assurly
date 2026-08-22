// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScanFindingCard } from './ScanFindingCard';
import type { ScanFinding } from '../../../utils/dbAdapter';

const finding: ScanFinding = {
  id: 'finding-1',
  scan_id: 'scan-1',
  rule_id: 'supabase-rls',
  severity: 'error',
  file_path: 'schema.sql',
  line_number: 1,
  message: "Supabase table 'users' is created but Row-Level Security (RLS) is not enabled.",
  suggestion: 'Enable RLS on the table.',
  created_at: '2026-06-26T09:52:00Z',
};

afterEach(() => {
  cleanup();
});

describe('ScanFindingCard', () => {
  it('renders severity styling through CSS classes instead of inline styles', () => {
    const { container } = render(
      <ScanFindingCard
        finding={finding}
        fixingFindingId={null}
        isFixable={true}
        onCreateFixPr={vi.fn()}
      />,
    );

    const card = container.querySelector('.scan-finding-card--error');
    expect(card).toBeTruthy();
    expect(card?.getAttribute('style')).toBeNull();
    expect(screen.getByText('error')).toBeTruthy();
    expect(screen.getByText('schema.sql:L1')).toBeTruthy();
    expect(screen.getByText(finding.message)).toBeTruthy();
    expect(screen.getByText('Enable RLS on the table.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /fix it/i })).toBeTruthy();
  });

  it('leads with the plain-language consequence and tucks technical detail away', () => {
    render(
      <ScanFindingCard
        finding={finding}
        fixingFindingId={null}
        isFixable={true}
        onCreateFixPr={vi.fn()}
      />,
    );

    // Primary line is the curated consequence, not the raw technical message.
    expect(screen.getByText(/anyone on the internet can read/i)).toBeTruthy();
    // Technical detail is present but behind a "For your developer" disclosure.
    expect(screen.getByText('For your developer')).toBeTruthy();
    expect(screen.getByText(finding.message)).toBeTruthy();
  });

  it('leads with the safety-net copy when RLS is missing on a non-Supabase table', () => {
    render(
      <ScanFindingCard
        finding={{
          ...finding,
          severity: 'warning',
          message:
            "Database table 'organizations' is created but Row-Level Security (RLS) is not enabled.",
        }}
        fixingFindingId={null}
        isFixable={false}
        onCreateFixPr={vi.fn()}
      />,
    );

    expect(screen.queryByText(/anyone on the internet can read/i)).toBeNull();
    expect(screen.getByText(/missing safety net rather than a live leak/i)).toBeTruthy();
  });

  it('leads with the unread-backend copy for scan-language-coverage', () => {
    render(
      <ScanFindingCard
        finding={{
          ...finding,
          rule_id: 'scan-language-coverage',
          severity: 'warning',
          file_path: 'internal/handler/http/stripe_handler.go',
          message:
            "53 Go files were not analysed — Assurly's rules cover JavaScript, TypeScript and SQL. They include payment and authentication code (internal/handler/http/stripe_handler.go).",
        }}
        fixingFindingId={null}
        isFixable={false}
        onCreateFixPr={vi.fn()}
      />,
    );

    expect(screen.getByText(/files nobody checked/i)).toBeTruthy();
    expect(screen.queryByText(/anyone on the internet can read/i)).toBeNull();
  });

  it('shows a linked fix PR when one already exists', () => {
    render(
      <ScanFindingCard
        finding={{
          ...finding,
          fix_pr_url: 'https://github.com/acme/repo/pull/42',
        }}
        fixingFindingId={null}
        isFixable={true}
        onCreateFixPr={vi.fn()}
      />,
    );

    const link = screen.getByRole('link', { name: /view fix pr/i });
    expect(link.getAttribute('href')).toBe('https://github.com/acme/repo/pull/42');
  });

  it('shows an occurrence badge when the same issue appears multiple times', () => {
    render(
      <ScanFindingCard
        finding={finding}
        occurrenceCount={3}
        fixingFindingId={null}
        isFixable={true}
        onCreateFixPr={vi.fn()}
      />,
    );

    expect(screen.getByTestId('scan-finding-occurrence-finding-1').textContent).toBe('×3');
  });

  it('passes the representative finding id to Fix it', () => {
    const onCreateFixPr = vi.fn();

    render(
      <ScanFindingCard
        finding={finding}
        occurrenceCount={3}
        fixingFindingId={null}
        isFixable={true}
        onCreateFixPr={onCreateFixPr}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /fix it/i }));

    expect(onCreateFixPr).toHaveBeenCalledTimes(1);
    expect(onCreateFixPr).toHaveBeenCalledWith(finding);
  });
});
