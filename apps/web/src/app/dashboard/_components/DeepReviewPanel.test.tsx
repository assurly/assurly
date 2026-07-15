// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DeepReviewPanel, type DeepReviewView } from './DeepReviewPanel';

afterEach(cleanup);

const sampleReview: DeepReviewView = {
  summary: 'Your customer table is world-readable via the anon key.',
  findings: [
    {
      title: 'Open customers table',
      risk: 'Anyone can read emails.',
      recommendation: 'Enable RLS on customers.',
    },
    {
      title: 'Missing CSP',
      risk: 'XSS can steal session tokens.',
      recommendation: 'Deploy a strict Content-Security-Policy.',
    },
  ],
  source: 'ai',
};

describe('DeepReviewPanel', () => {
  it('renders a collapsed summary with the finding count', () => {
    render(<DeepReviewPanel review={sampleReview} />);

    const panel = screen.getByTestId('deep-review');
    expect(panel.tagName).toBe('DETAILS');
    expect((panel as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText('AI deep review')).toBeTruthy();
    expect(screen.getByText('2 deep risks')).toBeTruthy();
  });

  it('exposes the summary and each finding for screen readers when opened', () => {
    render(<DeepReviewPanel review={sampleReview} />);

    expect(screen.getByText(sampleReview.summary)).toBeTruthy();
    expect(screen.getByText('Open customers table')).toBeTruthy();
    expect(screen.getByText('Anyone can read emails.')).toBeTruthy();
    expect(screen.getByText('Enable RLS on customers.')).toBeTruthy();
    expect(screen.getByText('Missing CSP')).toBeTruthy();
  });

  it('renders summary-only when there are no findings', () => {
    render(
      <DeepReviewPanel
        review={{
          summary: 'No high-value app-specific risks beyond Layer 1.',
          findings: [],
          source: 'ai',
        }}
      />,
    );

    expect(screen.getByText('Deep review')).toBeTruthy();
    expect(screen.getByText('No high-value app-specific risks beyond Layer 1.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
