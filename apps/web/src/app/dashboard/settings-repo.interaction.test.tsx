// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DashboardClient from './_components/DashboardClient';
import { installDashboardLocalStorageMock } from './testUtils/installDashboardLocalStorageMock';
import * as clientApiModule from '../../utils/clientApi';
import type { Scan } from '../../utils/dbAdapter';
import { __resetScansQueryCacheForTests } from '../../utils/scansQueryCache';

type SessionResult = clientApiModule.SessionResult;

const ATTESTA_ID = '11000000-0000-4000-8000-000000000010';
const LEAKS_ID = '11000000-0000-4000-8000-000000000011';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams({ view: 'app', repo: ATTESTA_ID }),
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

const attestaRepo = {
  id: ATTESTA_ID,
  organization_id: 'org-1',
  name: 'tibco87/Attesta',
  github_repo_id: 101,
  is_active: true,
  created_at: '2026-06-21T00:00:00Z',
};

const leaksRepo = {
  id: LEAKS_ID,
  organization_id: 'org-1',
  name: 'react-client-leaks',
  github_repo_id: 102,
  is_active: true,
  created_at: '2026-06-21T00:00:00Z',
};

const attestaScan: Scan = {
  id: '22000000-0000-4000-8000-000000000010',
  repository_id: attestaRepo.id,
  commit_sha: '669c0392ea81119689959fdbe63b05c3c95ce544',
  branch: 'main',
  status: 'failed',
  error_count: 1,
  warning_count: 0,
  created_at: '2026-06-26T08:55:00Z',
};

const session: SessionResult = {
  user: { id: 'user-1', name: 'Tibor Dev', email: 'dev@example.com', avatar_url: '' },
  organization: {
    id: 'org-1',
    name: 'acme',
    billing_plan: 'pro',
    github_installation_id: '140302856',
    created_at: '2026-06-21T00:00:00Z',
  },
  repositories: [attestaRepo, leaksRepo],
};

beforeEach(() => {
  __resetScansQueryCacheForTests();
  installDashboardLocalStorageMock();
  scansMock.mockReset();
  findingsMock.mockReset();
  scansMock.mockResolvedValue({ scans: [attestaScan] });
  findingsMock.mockResolvedValue({ findings: [] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Settings repository selection', () => {
  it('keeps view=settings and the current repo when opening Settings from the app workspace', async () => {
    render(<DashboardClient initialSession={session} />);
    expect(await screen.findByRole('button', { name: 'Back to Apps' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back to Apps' })).toBeNull();
    expect(window.location.search).toContain('view=settings');
    expect(window.location.search).toContain(`repo=${ATTESTA_ID}`);
    expect(
      screen
        .getByRole('button', { name: /select repository tibco87\/Attesta/i })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('heading', { name: 'Canary tokens' })).toBeTruthy();
  });

  it('stays on Settings when a different repository is selected there', async () => {
    render(<DashboardClient initialSession={session} />);
    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));
    await screen.findByTestId('repo-list-panel');

    fireEvent.click(screen.getByRole('button', { name: /select repository react-client-leaks/i }));

    await waitFor(() => {
      expect(window.location.search).toContain(`repo=${LEAKS_ID}`);
    });
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back to Apps' })).toBeNull();
    expect(window.location.search).toContain('view=settings');
    expect(
      screen
        .getByRole('button', { name: /select repository react-client-leaks/i })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('restores the Settings repo after visiting Apps overview', async () => {
    render(<DashboardClient initialSession={session} />);
    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));
    await screen.findByTestId('repo-list-panel');
    fireEvent.click(screen.getByRole('button', { name: /select repository react-client-leaks/i }));
    await waitFor(() => expect(window.location.search).toContain(`repo=${LEAKS_ID}`));

    fireEvent.click(screen.getByRole('button', { name: /^apps$/i }));
    expect(await screen.findByRole('heading', { name: 'Your apps' })).toBeTruthy();
    expect(window.location.search).not.toContain('view=settings');
    expect(window.location.search).not.toContain('repo=');

    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(window.location.search).toContain('view=settings');
    expect(window.location.search).toContain(`repo=${LEAKS_ID}`);
    expect(
      screen
        .getByRole('button', { name: /select repository react-client-leaks/i })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
