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
    guardianEnabled: true,
    scoreDropped: false,
    badgeToken: null,
    scanCapability: 'browser',
    lastScanFailed: false,
    lastScanFailureReason: null,
    ...overrides,
  };
}

describe('formatCheckedAt', () => {
  const now = new Date('2026-07-13T12:00:00.000Z').getTime();

  it('returns "Never scanned" for a null or invalid timestamp', () => {
    expect(formatCheckedAt(null, now)).toBe('Never scanned');
    expect(formatCheckedAt('not-a-date', now)).toBe('Never scanned');
  });

  it('returns "Checked just now" under a minute', () => {
    expect(formatCheckedAt('2026-07-13T11:59:30.000Z', now)).toBe('Checked just now');
    expect(formatCheckedAt('2026-07-13T11:59:01.000Z', now)).toBe('Checked just now');
  });

  it('formats minute granularity below the hour boundary', () => {
    expect(formatCheckedAt('2026-07-13T11:30:00.000Z', now)).toBe('Checked 30m ago');
    expect(formatCheckedAt('2026-07-13T11:01:00.000Z', now)).toBe('Checked 59m ago');
  });

  it('switches to hours exactly at the 60-minute boundary', () => {
    expect(formatCheckedAt('2026-07-13T11:00:00.000Z', now)).toBe('Checked 1h ago');
  });

  it('formats hour granularity below the day boundary', () => {
    expect(formatCheckedAt('2026-07-13T09:00:00.000Z', now)).toBe('Checked 3h ago');
    expect(formatCheckedAt('2026-07-12T13:00:00.000Z', now)).toBe('Checked 23h ago');
  });

  it('switches to days exactly at the 24-hour boundary', () => {
    expect(formatCheckedAt('2026-07-12T12:00:00.000Z', now)).toBe('Checked 1d ago');
  });

  it('formats several days', () => {
    expect(formatCheckedAt('2026-07-10T12:00:00.000Z', now)).toBe('Checked 3d ago');
    expect(formatCheckedAt('2026-07-06T12:00:00.000Z', now)).toBe('Checked 7d ago');
  });
});

describe('VerdictCard', () => {
  it('renders the blocked verdict, score, and the dominant issue', () => {
    render(<VerdictCard card={card()} onOpen={vi.fn()} />);
    expect(screen.getByText('api')).toBeTruthy();
    expect(screen.getByText('acme')).toBeTruthy();
    expect(screen.getByText('Not ready to ship')).toBeTruthy();
    expect(screen.getByText('76')).toBeTruthy();
    expect(screen.getByText(/Row-Level Security enabled/)).toBeTruthy();
  });

  it('keeps long repo and URL names distinguishable instead of a single clipped string', () => {
    const { rerender } = render(
      <VerdictCard card={card({ displayName: 'tibco87/shipready-web' })} onOpen={vi.fn()} />,
    );
    expect(screen.getByText('shipready-web')).toBeTruthy();
    expect(screen.getByText('tibco87')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /tibco87\/shipready-web/i }).getAttribute('title'),
    ).toBe('tibco87/shipready-web');

    rerender(
      <VerdictCard
        card={card({
          kind: 'url',
          repositoryId: null,
          displayName: 'https://gemini.google.com/app/demo',
          identifier: 'https://gemini.google.com/app/demo',
        })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('gemini.google.com')).toBeTruthy();
    expect(screen.getByText('/app/demo')).toBeTruthy();
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

  it('keeps cli_only cards openable so the Full Gate workspace can be selected', () => {
    const onOpen = vi.fn();
    const target = card({
      displayName: 'vercel/vercel',
      identifier: 'vercel/vercel',
      scanCapability: 'cli_only',
      verdict: 'unknown',
      shipScore: null,
      topIssue: null,
    });
    render(<VerdictCard card={target} onOpen={onOpen} />);

    const open = screen.getByRole('button', { name: /vercel\/vercel: Use CLI/i });
    expect(open).toHaveProperty('disabled', false);
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledWith(target);
    expect(
      screen.getByRole('button', { name: /Copy Full Gate command for vercel\/vercel/i }),
    ).toBeTruthy();
  });

  it('disables open when a repo card has no linked repositoryId', () => {
    render(
      <VerdictCard
        card={card({ repositoryId: null, scanCapability: 'cli_only' })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /acme\/api: Use CLI/i })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('shows a regression indicator when score dropped without repeating Guardian on repos', () => {
    render(
      <VerdictCard card={card({ guardianEnabled: true, scoreDropped: true })} onOpen={vi.fn()} />,
    );
    expect(screen.queryByText('Guardian')).toBeNull();
    expect(screen.getByText(/Score dropped since last check/i)).toBeTruthy();
  });

  it('shows Guardian only for guarded URL apps', () => {
    render(
      <VerdictCard
        card={card({
          kind: 'url',
          repositoryId: null,
          displayName: 'https://ok.app',
          guardianEnabled: true,
          ownershipVerified: true,
          verdict: 'ready',
          topIssue: null,
        })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('Guardian')).toBeTruthy();
  });

  it('hides repeated ready copy in compact density', () => {
    render(
      <VerdictCard
        card={card({ verdict: 'ready', shipScore: 96, topIssue: null })}
        onOpen={vi.fn()}
        density="compact"
      />,
    );
    expect(screen.queryByText(/safe to deploy/i)).toBeNull();
    expect(screen.queryByText('Ready to ship')).toBeNull();
    expect(screen.getByText('96')).toBeTruthy();
  });

  it('shows a Rescan CTA for stale checks and invokes onRescan without opening the card', () => {
    const onOpen = vi.fn();
    const onRescan = vi.fn();
    const target = card({
      lastCheckedAt: '2026-06-01T10:00:00.000Z',
    });

    render(<VerdictCard card={target} onOpen={onOpen} onRescan={onRescan} />);

    const rescan = screen.getByRole('button', { name: /Rescan acme\/api/i });
    expect(rescan).toBeTruthy();
    fireEvent.click(rescan);
    expect(onRescan).toHaveBeenCalledWith(target);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows Scan now when the app was never checked', () => {
    render(
      <VerdictCard
        card={card({ lastCheckedAt: null, verdict: 'unknown', shipScore: null, topIssue: null })}
        onOpen={vi.fn()}
        onRescan={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Scan now acme\/api/i })).toBeTruthy();
  });

  it('hides Rescan for fresh checks', () => {
    render(
      <VerdictCard
        card={card({ lastCheckedAt: new Date().toISOString() })}
        onOpen={vi.fn()}
        onRescan={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Rescan/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Scan now/i })).toBeNull();
  });

  it('shows Scan failed and Scan now after a fresh empty-scan failure', () => {
    render(
      <VerdictCard
        card={card({
          verdict: 'unknown',
          shipScore: null,
          topIssue: null,
          lastCheckedAt: new Date().toISOString(),
          lastScanFailed: true,
          lastScanFailureReason: 'no_eligible_files',
        })}
        onOpen={vi.fn()}
        onRescan={vi.fn()}
      />,
    );
    expect(screen.getByText('Scan failed')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText(/Scan failed ·/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Scan now acme\/api/i })).toBeTruthy();
  });

  it('keeps Scanning… disabled while rescanning and blocks sibling CTAs', () => {
    render(
      <VerdictCard
        card={card({ lastCheckedAt: '2026-06-01T10:00:00.000Z' })}
        onOpen={vi.fn()}
        onRescan={vi.fn()}
        rescanning
      />,
    );
    const busy = screen.getByRole('button', { name: /Scanning acme\/api/i });
    expect(busy.textContent).toContain('Scanning…');
    expect(busy).toHaveProperty('disabled', true);
  });

  it('disables Rescan when another scan is already running', () => {
    render(
      <VerdictCard
        card={card({ lastCheckedAt: '2026-06-01T10:00:00.000Z' })}
        onOpen={vi.fn()}
        onRescan={vi.fn()}
        rescanBlocked
      />,
    );
    expect(screen.getByRole('button', { name: /Rescan acme\/api/i })).toHaveProperty(
      'disabled',
      true,
    );
  });
});
