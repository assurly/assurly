// @vitest-environment jsdom

/**
 * The per-repository scan count is shown in exactly one place: the repo list
 * inside Settings. It used to be prefetched for every connected repository on
 * every dashboard load — one `/api/scans?repoId=` per repo, each pulling full
 * scan rows, for a number nobody sees until Settings is opened. On a 24-repo
 * account that is 24 concurrent reads on the critical path, and it is the
 * contention that forced the Supabase read budget up to 30s.
 *
 * These tests pin where that work is allowed to happen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DashboardClient from './_components/DashboardClient';
import { installDashboardLocalStorageMock } from './testUtils/installDashboardLocalStorageMock';
import * as clientApiModule from '../../utils/clientApi';
import type { Scan } from '../../utils/dbAdapter';
import { __resetScansQueryCacheForTests } from '../../utils/scansQueryCache';

type SessionResult = clientApiModule.SessionResult;

const SELECTED_ID = '11000000-0000-4000-8000-000000000010';
const OTHER_ID = '11000000-0000-4000-8000-000000000011';
const THIRD_ID = '11000000-0000-4000-8000-000000000012';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams({ view: 'app', repo: SELECTED_ID }),
}));

vi.mock('./_components/manual-checker/ManualChecker', () => ({
  default: () => null,
}));

vi.mock('../../utils/clientApi', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof clientApiModule;
  return {
    ...actual,
    clientApi: {
      ...actual.clientApi,
      targets: vi.fn(async () => ({ targets: [] })),
      scans: vi.fn(),
      findings: vi.fn(),
    },
  };
});

const { clientApi } = clientApiModule;
const scansMock = vi.mocked(clientApi.scans);
const findingsMock = vi.mocked(clientApi.findings);

function repo(id: string, name: string, githubRepoId: number) {
  return {
    id,
    organization_id: 'org-1',
    name,
    github_repo_id: githubRepoId,
    is_active: true,
    created_at: '2026-06-21T00:00:00Z',
  };
}

const selectedRepo = repo(SELECTED_ID, 'tibco87/Attesta', 101);
const otherRepo = repo(OTHER_ID, 'react-client-leaks', 102);
const thirdRepo = repo(THIRD_ID, 'tibco87/Portfolio', 103);

function scanFor(repositoryId: string): Scan {
  return {
    id: `22000000-0000-4000-8000-0000000000${repositoryId.slice(-2)}`,
    repository_id: repositoryId,
    commit_sha: '669c0392ea81119689959fdbe63b05c3c95ce544',
    branch: 'main',
    status: 'failed',
    error_count: 1,
    warning_count: 0,
    created_at: '2026-06-26T08:55:00Z',
  };
}

const session: SessionResult = {
  user: { id: 'user-1', name: 'Tibor Dev', email: 'dev@example.com', avatar_url: '' },
  organization: {
    id: 'org-1',
    name: 'acme',
    billing_plan: 'pro',
    github_installation_id: '140302856',
    created_at: '2026-06-21T00:00:00Z',
  },
  repositories: [selectedRepo, otherRepo, thirdRepo],
};

/** Repository ids the dashboard actually asked the scans endpoint for. */
function fetchedRepoIds(): string[] {
  return scansMock.mock.calls.map((call) => call[0] as string);
}

beforeEach(() => {
  __resetScansQueryCacheForTests();
  installDashboardLocalStorageMock();
  scansMock.mockReset();
  findingsMock.mockReset();
  scansMock.mockImplementation(async (repositoryId: string) => ({
    scans: [scanFor(repositoryId)],
  }));
  findingsMock.mockResolvedValue({ findings: [] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('scan-count prefetch', () => {
  it('reads scan history only for the open repository on the app view', async () => {
    render(<DashboardClient initialSession={session} />);
    expect(await screen.findByRole('button', { name: 'Back to Apps' })).toBeTruthy();

    // The open repo's history is genuinely needed — the workspace renders it.
    await waitFor(() => expect(fetchedRepoIds()).toContain(SELECTED_ID));

    expect(fetchedRepoIds()).not.toContain(OTHER_ID);
    expect(fetchedRepoIds()).not.toContain(THIRD_ID);
  });

  it('reads every repository only once Settings, which shows the counts, is open', async () => {
    render(<DashboardClient initialSession={session} />);
    expect(await screen.findByRole('button', { name: 'Back to Apps' })).toBeTruthy();
    await waitFor(() => expect(fetchedRepoIds()).toContain(SELECTED_ID));

    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));
    await screen.findByTestId('repo-list-panel');

    await waitFor(() => {
      expect(fetchedRepoIds()).toContain(OTHER_ID);
      expect(fetchedRepoIds()).toContain(THIRD_ID);
    });
  });

  it('still shows each repository real scan count in the Settings list', async () => {
    render(<DashboardClient initialSession={session} />);
    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));
    await screen.findByTestId('repo-list-panel');

    // Would read "No scans" if gating the prefetch had starved the list.
    await waitFor(() => {
      const row = screen.getByRole('button', { name: /select repository react-client-leaks/i });
      expect(row.textContent).toContain('1 scan');
    });
  });
});
