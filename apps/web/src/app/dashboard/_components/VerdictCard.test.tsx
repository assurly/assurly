// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VerdictCard, formatCheckedAt } from './VerdictCard';
import type { TargetCard } from '../../../utils/clientApi';

afterEach(() => cleanup());

function card(overrides: Partial<TargetCard> = {}): TargetCard {
  return {
    id: 'target-1',
    kind: 'repo',
    identifier: 'acme/api',
    displayName: 'acme/api',
    repositoryId: 'repo-1',
    generatorFingerprint: null,
    verdict: 'blocked',
    shipScore: 76,
    topIssue: {
      key: 'supabase-rls',
      label: 'Row-Level Security',
      severity: 'error',
      sampleMessage: "Table 'users' is created without Row-Level Security enabled.",
      affectedFileCount: 1,
      occurrenceCount: 1,
    },
    lastCheckedAt: '2026-07-13T10:00:00.000Z',
    latestScanId: 'scan-9',
    ownershipVerified: false,
    ...overrides,
  };
}

describe('formatCheckedAt', () => {
  const now = new Date('2026-07-13T12:00:00.000Z').getTime();

  it('returns "Never scanned" for a null or invalid timestamp', () => {
    expect(formatCheckedAt(null, now)).toBe('Never scanned');
    expect(formatCheckedAt('not-a-date', now)).toBe('Never scanned');
  });

  it('formats recent, minute, hour, and day granularities', () => {
    expect(formatCheckedAt('2026-07-13T11:59:30.000Z', now)).toBe('Checked just now');
    expect(formatCheckedAt('2026-07-13T11:30:00.000Z', now)).toBe('Checked 30m ago');
    expect(formatCheckedAt('2026-07-13T09:00:00.000Z', now)).toBe('Checked 3h ago');
    expect(formatCheckedAt('2026-07-10T12:00:00.000Z', now)).toBe('Checked 3d ago');
  });
});

describe('VerdictCard', () => {
  it('renders the blocked verdict, score, and the dominant issue', () => {
    render(<VerdictCard card={card()} onOpen={vi.fn()} />);
    expect(screen.getByText('acme/api')).toBeTruthy();
    expect(screen.getByText('Not ready to ship')).toBeTruthy();
    expect(screen.getByText('76')).toBeTruthy();
    expect(screen.getByText(/Row-Level Security enabled/)).toBeTruthy();
  });

  it('shows a reassuring line and a dash score for a ready app with no issue', () => {
    render(
      <VerdictCard
        card={card({ verdict: 'ready', shipScore: 100, topIssue: null })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('Ready to ship')).toBeTruthy();
    expect(screen.getByText(/safe to deploy/i)).toBeTruthy();
  });

  it('shows a builder chip when a generator fingerprint is known', () => {
    render(<VerdictCard card={card({ generatorFingerprint: 'lovable' })} onOpen={vi.fn()} />);
    expect(screen.getByText('Lovable')).toBeTruthy();
  });

  it('renders an unscanned app as "Not scanned yet" with a dash score', () => {
    render(
      <VerdictCard
        card={card({ verdict: 'unknown', shipScore: null, topIssue: null, lastCheckedAt: null })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('Not scanned yet')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('Never scanned')).toBeTruthy();
  });

  it('invokes onOpen with the full card when clicked', () => {
    const onOpen = vi.fn();
    const target = card();
    render(<VerdictCard card={target} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /acme\/api/i }));
    expect(onOpen).toHaveBeenCalledWith(target);
  });
});
