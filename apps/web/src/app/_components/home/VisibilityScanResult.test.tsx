// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  VisibilityScanResult,
  isVisibilityHeadline,
  type VisibilityHeadline,
  type VisibilityView,
} from './VisibilityScanResult';

afterEach(() => {
  cleanup();
});

const headline: VisibilityHeadline = {
  score: 42,
  aiReadinessScore: 30,
  searchReadinessScore: 55,
  verdict: 'partial',
};

const entitledWithChecks: VisibilityView = {
  ...headline,
  checks: [
    {
      id: 'ai-llms-txt',
      title: 'llms.txt is published',
      group: 'ai',
      status: 'fail',
      detail: 'llms.txt is absent or empty.',
      fix: 'Serve /llms.txt with a clear site summary.',
    },
  ],
};

describe('VisibilityScanResult', () => {
  it('renders the live headline with score, subscores, and verdict', () => {
    render(<VisibilityScanResult report={headline} />);

    expect(screen.getByRole('heading', { name: /SEO & GEO Audit/i })).toBeTruthy();
    expect(screen.getByTestId('visibility-audit-verdict').textContent).toContain(
      'PARTIALLY VISIBLE',
    );
    expect(screen.getByLabelText('AI Readiness Score 42 out of 100').textContent).toContain(
      '42/100',
    );
    expect(screen.getByText('AI readiness')).toBeTruthy();
    expect(screen.getByText('Search readiness')).toBeTruthy();
    expect(screen.queryByTestId('visibility-audit-checks')).toBeNull();
  });

  it('locked state shows the headline and never the per-check list', () => {
    render(
      <VisibilityScanResult
        report={entitledWithChecks}
        locked
        lockedHint="Sign in on Pro to unlock every check and the exact fix for each gap."
      />,
    );

    expect(screen.getByLabelText('AI Readiness Score 42 out of 100')).toBeTruthy();
    expect(screen.queryByTestId('visibility-audit-checks')).toBeNull();
    expect(screen.queryByText('llms.txt is published')).toBeNull();
    expect(screen.queryByText('Serve /llms.txt with a clear site summary.')).toBeNull();
    expect(screen.getByTestId('visibility-audit-locked-hint').textContent).toMatch(
      /Sign in on Pro/,
    );
  });

  it('renders nothing when the visibility payload is absent', () => {
    const { container: missing } = render(<VisibilityScanResult report={undefined} />);
    expect(missing.firstChild).toBeNull();

    const { container: nulled } = render(<VisibilityScanResult report={null} />);
    expect(nulled.firstChild).toBeNull();

    expect(screen.queryByTestId('visibility-audit')).toBeNull();
    expect(screen.queryByText(/N\/A/i)).toBeNull();
    expect(screen.queryByText('0/100')).toBeNull();
  });

  it('deliberate-break guard: locked must drop checks even when the client still holds them', () => {
    // If someone "unlocks" the marketing surface by ignoring `locked`, anonymous
    // visitors would see Pro-only fixes. This assertion is the paywall.
    const withCanonical: VisibilityView = {
      ...headline,
      checks: [
        {
          id: 'seo-canonical',
          title: 'Canonical URL matches this page',
          group: 'search',
          status: 'fail',
          detail: 'No canonical.',
          fix: 'Add a matching <link rel="canonical">.',
        },
      ],
    };

    const { rerender } = render(<VisibilityScanResult report={withCanonical} locked />);
    expect(screen.queryByTestId('visibility-audit-checks')).toBeNull();

    // Deliberate break: render the same payload unlocked — checks appear.
    // The production path must keep locked=true for anonymous / free callers.
    rerender(<VisibilityScanResult report={withCanonical} locked={false} />);
    expect(screen.getByTestId('visibility-audit-checks')).toBeTruthy();
    expect(screen.getByText('Canonical URL matches this page')).toBeTruthy();
  });
});

describe('isVisibilityHeadline', () => {
  it('accepts a complete headline and rejects incomplete shapes', () => {
    expect(isVisibilityHeadline(headline)).toBe(true);
    expect(isVisibilityHeadline(null)).toBe(false);
    expect(isVisibilityHeadline({ score: 1 })).toBe(false);
    expect(isVisibilityHeadline({ ...headline, verdict: 'READY TO SHIP' })).toBe(false);
  });
});
