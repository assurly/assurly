// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TargetCard } from '../../../utils/clientApi';
import { VerdictCardsSection } from './VerdictCardsSection';

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
});
