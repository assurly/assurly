// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VisibilityAuditPanel, type VisibilityView } from './VisibilityAuditPanel';
import type { VisibilityCheck } from '../../../utils/visibilityScan';

afterEach(() => {
  cleanup();
});

const sampleChecks: VisibilityCheck[] = [
  {
    id: 'ai-ssr-content',
    title: 'Content is server-rendered',
    group: 'ai',
    status: 'pass',
    detail: 'Visible server HTML text is 1200 characters.',
  },
  {
    id: 'ai-llms-txt',
    title: 'llms.txt is published',
    group: 'ai',
    status: 'fail',
    detail: 'llms.txt is absent or empty.',
    fix: 'Serve /llms.txt with a clear site summary.',
  },
  {
    id: 'seo-og-image',
    title: 'og:image is declared and reachable',
    group: 'search',
    status: 'skipped',
    detail: 'og:image is declared, but the HEAD probe was not run.',
  },
];

const entitledReport: VisibilityView = {
  score: 62,
  aiReadinessScore: 55,
  searchReadinessScore: 70,
  verdict: 'partial',
  checks: sampleChecks,
};

const lockedReport: VisibilityView = {
  score: 62,
  aiReadinessScore: 55,
  searchReadinessScore: 70,
  verdict: 'partial',
};

describe('VisibilityAuditPanel', () => {
  it('renders entitled report with score, verdict, and checks', () => {
    render(<VisibilityAuditPanel report={entitledReport} />);

    expect(screen.getByRole('heading', { name: /SEO & GEO Audit/i })).toBeTruthy();
    expect(screen.getByTestId('visibility-audit-verdict').textContent).toContain(
      'PARTIALLY VISIBLE',
    );
    expect(screen.getByLabelText('AI Readiness Score 62 out of 100').textContent).toContain(
      '62/100',
    );
    expect(screen.getByText('AI readiness')).toBeTruthy();
    expect(screen.getByText('Search readiness')).toBeTruthy();
    expect(screen.getByTestId('visibility-audit-checks')).toBeTruthy();
    expect(screen.getByText('llms.txt is published')).toBeTruthy();
    expect(screen.getByText('Serve /llms.txt with a clear site summary.')).toBeTruthy();
  });

  it('locked state shows headline and not the checks', () => {
    render(<VisibilityAuditPanel report={lockedReport} locked />);

    expect(screen.getByTestId('visibility-audit-verdict').textContent).toContain(
      'PARTIALLY VISIBLE',
    );
    expect(screen.getByLabelText('AI Readiness Score 62 out of 100')).toBeTruthy();
    expect(screen.queryByTestId('visibility-audit-checks')).toBeNull();
    expect(screen.getByTestId('visibility-audit-locked-hint').textContent).toMatch(
      /Upgrade to Pro/,
    );
  });

  it('renders skipped checks as "Not checked", distinct from failures', () => {
    render(<VisibilityAuditPanel report={entitledReport} />);

    const skipped = screen.getByTestId('visibility-check-seo-og-image');
    expect(skipped.textContent).toContain('Not checked');
    expect(skipped.className).toContain('visibility-audit__check--skipped');

    const failed = screen.getByTestId('visibility-check-ai-llms-txt');
    expect(failed.textContent).toContain('Fail');
    expect(failed.textContent).not.toContain('Not checked');
  });

  it('uses INVISIBLE TO AI / FULLY VISIBLE vocabulary (not Ship Gate wording)', () => {
    const { rerender } = render(
      <VisibilityAuditPanel
        report={{ score: 10, aiReadinessScore: 5, searchReadinessScore: 15, verdict: 'invisible' }}
      />,
    );
    expect(screen.getByText('INVISIBLE TO AI')).toBeTruthy();
    expect(screen.queryByText(/READY TO SHIP/)).toBeNull();

    rerender(
      <VisibilityAuditPanel
        report={{ score: 95, aiReadinessScore: 90, searchReadinessScore: 100, verdict: 'visible' }}
      />,
    );
    expect(screen.getByText('FULLY VISIBLE')).toBeTruthy();
  });
});
