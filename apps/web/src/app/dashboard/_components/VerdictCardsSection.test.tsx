// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TargetCard } from '../../../utils/clientApi';
import { VerdictCardsSection } from './VerdictCardsSection';
import { VERDICT_CARDS_PREFS_KEY } from './verdictCardsView';

const memoryStore = new Map<string, string>();

beforeEach(() => {
  memoryStore.clear();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string): string | null => memoryStore.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        memoryStore.set(key, value);
      },
      removeItem: (key: string): void => {
        memoryStore.delete(key);
      },
    },
  });
});

afterEach(() => {
  cleanup();
});

function card(
  partial: Partial<TargetCard> & Pick<TargetCard, 'id' | 'kind' | 'verdict'>,
): TargetCard {
  return {
    identifier: partial.identifier ?? partial.id,
    displayName: partial.displayName ?? 'https://example.com',
    repositoryId: partial.repositoryId ?? null,
    generatorFingerprint: partial.generatorFingerprint ?? null,
    shipScore: partial.shipScore ?? 96,
    topIssue: partial.topIssue ?? null,
    lastCheckedAt: partial.lastCheckedAt ?? null,
    latestScanId: partial.latestScanId ?? null,
    ownershipVerified: partial.ownershipVerified ?? false,
    guardianEnabled: partial.guardianEnabled ?? false,
    scoreDropped: partial.scoreDropped ?? false,
    badgeToken: partial.badgeToken ?? null,
    scanCapability: partial.scanCapability ?? 'browser',
    lastScanFailed: partial.lastScanFailed ?? false,
    lastScanFailureReason: partial.lastScanFailureReason ?? null,
    ...partial,
  };
}

describe('VerdictCardsSection', () => {
  it('shows skeletons while cards are loading', () => {
    const { container } = render(
      <VerdictCardsSection onOpenRepo={vi.fn()} cards={null} error={null} />,
    );
    expect(container.querySelectorAll('.verdict-card-skeleton').length).toBe(3);
  });

  it('renders an empty state when there are no apps', () => {
    render(<VerdictCardsSection onOpenRepo={vi.fn()} cards={[]} error={null} />);
    expect(screen.getByText(/No guarded apps yet/i)).toBeTruthy();
  });

  it('renders provided cards without fetching', () => {
    render(
      <VerdictCardsSection
        onOpenRepo={vi.fn()}
        cards={[card({ id: 't1', kind: 'url', verdict: 'ready', displayName: 'https://ok.app' })]}
        error={null}
      />,
    );
    expect(screen.getByText('ok.app')).toBeTruthy();
    expect(screen.getByRole('button', { name: /https:\/\/ok\.app/i })).toBeTruthy();
  });

  it('filters All / Repositories / URLs', () => {
    render(
      <VerdictCardsSection
        onOpenRepo={vi.fn()}
        cards={[
          card({
            id: 'r1',
            kind: 'repo',
            verdict: 'ready',
            displayName: 'acme/api',
            repositoryId: 'repo-1',
          }),
          card({
            id: 'u1',
            kind: 'url',
            verdict: 'review',
            displayName: 'https://ok.app',
            ownershipVerified: true,
            guardianEnabled: true,
          }),
        ]}
        error={null}
      />,
    );

    expect(screen.getByText('api')).toBeTruthy();
    expect(screen.getByText('acme')).toBeTruthy();
    expect(screen.getByText('ok.app')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Repositories \(1\)/i }));
    expect(screen.getByText('api')).toBeTruthy();
    expect(screen.queryByText('ok.app')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /URLs \(1\)/i }));
    expect(screen.getByText('ok.app')).toBeTruthy();
    expect(screen.queryByText('api')).toBeNull();
  });

  it('filters by verdict and sorts blockers first by default', () => {
    render(
      <VerdictCardsSection
        onOpenRepo={vi.fn()}
        cards={[
          card({
            id: 'ready',
            kind: 'repo',
            verdict: 'ready',
            displayName: 'acme/ready',
            repositoryId: 'repo-ready',
            shipScore: 96,
          }),
          card({
            id: 'blocked',
            kind: 'repo',
            verdict: 'blocked',
            displayName: 'acme/blocked',
            repositoryId: 'repo-blocked',
            shipScore: 40,
          }),
          card({
            id: 'review',
            kind: 'url',
            verdict: 'review',
            displayName: 'https://review.app',
            shipScore: 92,
          }),
        ]}
        error={null}
      />,
    );

    const list = screen.getByTestId('apps-card-list');
    const names = [...list.querySelectorAll('.verdict-card__name')].map((node) => node.textContent);
    expect(names[0]).toBe('blocked');
    expect(names[1]).toBe('review.app');
    expect(names[2]).toBe('ready');

    fireEvent.click(screen.getByRole('button', { name: /Blocked \(1\)/i }));
    expect(screen.getByText('blocked')).toBeTruthy();
    expect(screen.queryByText('ready')).toBeNull();
    expect(screen.queryByText('review.app')).toBeNull();
  });

  it('switches to compact list density', () => {
    render(
      <VerdictCardsSection
        onOpenRepo={vi.fn()}
        cards={[
          card({
            id: 'r1',
            kind: 'repo',
            verdict: 'ready',
            displayName: 'acme/api',
            repositoryId: 'repo-1',
          }),
        ]}
        error={null}
      />,
    );

    fireEvent.click(screen.getByTestId('apps-density-compact'));
    expect(screen.getByTestId('apps-card-list').className).toContain('verdict-card-list--compact');
    expect(screen.getByTestId('apps-density-compact').getAttribute('aria-pressed')).toBe('true');
  });

  it('restores Compact and Blocked from localStorage after remount', async () => {
    const cards = [
      card({
        id: 'blocked',
        kind: 'repo',
        verdict: 'blocked',
        displayName: 'acme/blocked',
        repositoryId: 'repo-blocked',
        shipScore: 40,
      }),
      card({
        id: 'ready',
        kind: 'repo',
        verdict: 'ready',
        displayName: 'acme/ready',
        repositoryId: 'repo-ready',
        shipScore: 96,
      }),
    ];

    const { unmount } = render(
      <VerdictCardsSection onOpenRepo={vi.fn()} cards={cards} error={null} />,
    );

    fireEvent.click(screen.getByTestId('apps-density-compact'));
    fireEvent.click(screen.getByRole('button', { name: /Blocked \(1\)/i }));
    expect(screen.getByTestId('apps-density-compact').getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole('button', { name: /Blocked \(1\)/i }).getAttribute('aria-pressed'),
    ).toBe('true');

    unmount();

    render(<VerdictCardsSection onOpenRepo={vi.fn()} cards={cards} error={null} />);

    await waitFor(() => {
      expect(screen.getByTestId('apps-density-compact').getAttribute('aria-pressed')).toBe('true');
      expect(
        screen.getByRole('button', { name: /Blocked \(1\)/i }).getAttribute('aria-pressed'),
      ).toBe('true');
    });
  });

  it('does not write default comfortable density before restoring prefs', async () => {
    window.localStorage.setItem(
      VERDICT_CARDS_PREFS_KEY,
      JSON.stringify({
        density: 'compact',
        sort: 'urgency',
        kindFilter: 'all',
        verdictFilter: 'blocked',
      }),
    );
    const writes: string[] = [];
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = (key: string, value: string) => {
      if (key === VERDICT_CARDS_PREFS_KEY) writes.push(value);
      originalSetItem(key, value);
    };

    try {
      render(
        <VerdictCardsSection
          onOpenRepo={vi.fn()}
          cards={[
            card({
              id: 'blocked',
              kind: 'repo',
              verdict: 'blocked',
              displayName: 'acme/blocked',
              repositoryId: 'repo-blocked',
              shipScore: 40,
            }),
          ]}
          error={null}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('apps-density-compact').getAttribute('aria-pressed')).toBe(
          'true',
        );
        expect(
          screen.getByRole('button', { name: /Blocked \(1\)/i }).getAttribute('aria-pressed'),
        ).toBe('true');
      });

      expect(writes.length).toBeGreaterThan(0);
      for (const write of writes) {
        const parsed = JSON.parse(write) as { density: string; verdictFilter: string };
        expect(parsed.density).toBe('compact');
        expect(parsed.verdictFilter).toBe('blocked');
      }
    } finally {
      window.localStorage.setItem = originalSetItem;
    }
  });

  it('forwards Rescan from a stale card to onRescan', () => {
    const onRescan = vi.fn();
    const stale = card({
      id: 'r-stale',
      kind: 'repo',
      verdict: 'ready',
      displayName: 'acme/api',
      repositoryId: 'repo-1',
      lastCheckedAt: '2026-06-01T00:00:00.000Z',
    });

    render(
      <VerdictCardsSection onOpenRepo={vi.fn()} onRescan={onRescan} cards={[stale]} error={null} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Rescan acme\/api/i }));
    expect(onRescan).toHaveBeenCalledWith(stale);
  });

  it('asks for confirmation before removing a URL card', () => {
    const onRemoveUrl = vi.fn();
    render(
      <VerdictCardsSection
        onOpenRepo={vi.fn()}
        onRemoveUrl={onRemoveUrl}
        cards={[
          card({
            id: 'u1',
            kind: 'url',
            verdict: 'ready',
            displayName: 'https://ok.app',
            ownershipVerified: true,
          }),
        ]}
        error={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Remove https:\/\/ok\.app/i }));
    expect(onRemoveUrl).not.toHaveBeenCalled();
    expect(screen.getByTestId('remove-url-dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Remove guarded URL/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('remove-url-dialog')).toBeNull();
    expect(onRemoveUrl).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Remove https:\/\/ok\.app/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove URL' }));
    expect(onRemoveUrl).toHaveBeenCalledWith('u1');
  });

  it('asks for confirmation before removing a connected repository card', () => {
    const onRemoveRepo = vi.fn();
    render(
      <VerdictCardsSection
        onOpenRepo={vi.fn()}
        onRemoveRepo={onRemoveRepo}
        cards={[
          card({
            id: 'r1',
            kind: 'repo',
            verdict: 'ready',
            displayName: 'facebook/stylex',
            repositoryId: 'repo-1',
            scanCapability: 'browser',
          }),
        ]}
        error={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Remove facebook\/stylex/i }));
    expect(onRemoveRepo).not.toHaveBeenCalled();
    expect(screen.getByTestId('remove-url-dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Remove repository/i })).toBeTruthy();
    expect(screen.getByText(/Connect & Scan/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRemoveRepo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Remove facebook\/stylex/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove repository' }));
    expect(onRemoveRepo).toHaveBeenCalledWith('repo-1');
  });
});
