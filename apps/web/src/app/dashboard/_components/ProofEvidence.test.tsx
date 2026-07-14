// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProofEvidence, type ProofEvidenceItem } from './ProofEvidence';

afterEach(() => {
  cleanup();
});

describe('ProofEvidence', () => {
  it('renders nothing when there is no evidence', () => {
    const { container } = render(<ProofEvidence evidence={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('leads with the most alarming item (rls_rows over missing_header)', () => {
    const evidence: ProofEvidenceItem[] = [
      {
        findingRuleId: 'runtime-missing-security-headers',
        kind: 'missing_header',
        summary: 'Your app is missing 2 protective headers.',
        redactedSample: { headers: ['CSP', 'HSTS'] },
      },
      {
        findingRuleId: 'runtime-supabase-rls-open',
        kind: 'rls_rows',
        summary: 'We read 500 rows from your `users` table using only the public key.',
        redactedSample: {
          table: 'users',
          rowCount: 500,
          columns: ['email'],
          sampleCell: 't***@***.com',
        },
      },
    ];
    render(<ProofEvidence evidence={evidence} />);

    const headline = screen.getByText(/we read 500 rows/i);
    expect(headline.className).toContain('proof-evidence__headline');
    // The redacted sample is shown, never a raw value.
    expect(screen.getByText('t***@***.com')).toBeTruthy();
    // The secondary item is listed below.
    expect(screen.getByText(/missing 2 protective headers/i)).toBeTruthy();
  });

  it('renders a masked secret without exposing the raw value', () => {
    const evidence: ProofEvidenceItem[] = [
      {
        findingRuleId: 'runtime-secret-in-bundle',
        kind: 'exposed_secret',
        summary: "A Stripe live secret key is readable in your app's public code.",
        redactedSample: { secretLabel: 'Stripe live secret key', maskedSecret: 'sk_live_****f456' },
      },
    ];
    render(<ProofEvidence evidence={evidence} />);
    expect(screen.getByText('sk_live_****f456')).toBeTruthy();
  });
});
