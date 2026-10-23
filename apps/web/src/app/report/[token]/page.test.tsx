// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getAdminDbAdapter: vi.fn(), notFound: vi.fn() }));
vi.mock('../../../utils/dbAdapter', () => ({ getAdminDbAdapter: mocks.getAdminDbAdapter }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    mocks.notFound();
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('../../_components/ThemeToggle', () => ({ ThemeToggle: () => null }));

import ReportPage from './page';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): string => new Date(Date.now() - days * DAY).toISOString();
const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);
const TOKEN = 'c'.repeat(32);

const db = {
  getTargetByBadgeToken: vi.fn(),
  getScanByShareToken: vi.fn(),
  getScanFindings: vi.fn(),
  getRepositoryNameForScan: vi.fn(),
  getRepository: vi.fn(),
  getRecentScans: vi.fn(),
};

async function renderReport(): Promise<void> {
  render(await ReportPage({ params: Promise.resolve({ token: TOKEN }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAdminDbAdapter.mockReturnValue(db);
  db.getTargetByBadgeToken.mockResolvedValue(null);
  db.getScanFindings.mockResolvedValue([]);
  db.getRepositoryNameForScan.mockResolvedValue('tibco87/my_portfolio');
  db.getRecentScans.mockResolvedValue([]);
  db.getRepository.mockResolvedValue({
    id: 'repo-1',
    default_branch: 'main',
    head_commit_sha: HEAD,
  });
});

afterEach(() => {
  cleanup();
});

describe('public trust page', () => {
  function readyTarget(lastCheckedAt: string) {
    return {
      id: 'target-1',
      kind: 'repo',
      identifier: 'tibco87/my_portfolio',
      display_name: 'tibco87/my_portfolio',
      repository_id: 'repo-1',
      badge_token: TOKEN,
      current_verdict: 'ready',
      current_ship_score: 100,
      last_checked_at: lastCheckedAt,
      verdict_evidence: {},
      generator_fingerprint: null,
    };
  }

  it('reports a months-old green verdict as history, not as the current state', async () => {
    db.getTargetByBadgeToken.mockResolvedValue(readyTarget(daysAgo(128)));
    db.getRepository.mockResolvedValue({ id: 'repo-1', default_branch: 'main' });

    await renderReport();

    expect(screen.queryByText(/^Ready to ship/)).toBeNull();
    expect(screen.getAllByText(/Ready 128 days ago/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('report-stale-notice').textContent).toBe(
      'This check is 128 days old; the code may have changed since.',
    );
  });

  it('says the code changed when a newer commit was pushed after a recent check', async () => {
    db.getTargetByBadgeToken.mockResolvedValue(readyTarget(daysAgo(0.1)));
    db.getRecentScans.mockResolvedValue([
      { id: 'scan-1', branch: 'main', commit_sha: OLDER, created_at: daysAgo(0.1) },
    ]);

    await renderReport();

    expect(screen.getAllByText(/Ready at an older commit/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('report-stale-notice').textContent).toBe(
      'The code has changed since this check.',
    );
  });

  it('shows a current verdict without a warning', async () => {
    db.getTargetByBadgeToken.mockResolvedValue(readyTarget(daysAgo(0.1)));
    db.getRecentScans.mockResolvedValue([
      { id: 'scan-1', branch: 'main', commit_sha: HEAD, created_at: daysAgo(0.1) },
    ]);

    await renderReport();

    expect(screen.getAllByText(/Ready to ship/).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('report-stale-notice')).toBeNull();
  });
});

describe('shared scan report', () => {
  function sharedScan(createdAt: string, commitSha: string) {
    return {
      id: 'scan-1',
      repository_id: 'repo-1',
      commit_sha: commitSha,
      branch: 'main',
      status: 'success',
      created_at: createdAt,
      share_token: TOKEN,
    };
  }

  it('dates the snapshot and flags code pushed since', async () => {
    db.getScanByShareToken.mockResolvedValue(sharedScan(daysAgo(2), OLDER));

    await renderReport();

    expect(screen.getByText(/Checked /)).toBeTruthy();
    expect(screen.getByTestId('report-stale-notice').textContent).toBe(
      'The code has changed since this check.',
    );
  });

  it('shows no warning for a recent snapshot of the newest commit', async () => {
    db.getScanByShareToken.mockResolvedValue(sharedScan(daysAgo(1), HEAD));

    await renderReport();

    expect(screen.queryByTestId('report-stale-notice')).toBeNull();
  });
});
