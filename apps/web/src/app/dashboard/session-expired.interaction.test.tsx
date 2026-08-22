// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import DashboardClient from './_components/DashboardClient';
import * as clientApiModule from '../../utils/clientApi';
import { __resetScansQueryCacheForTests } from '../../utils/scansQueryCache';
import {
  __resetUnauthorizedSessionForTests,
  SESSION_EXPIRED_MESSAGE,
} from '../../utils/unauthorizedSession';

type SessionResult = clientApiModule.SessionResult;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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
      saveScan: vi.fn(),
      findings: vi.fn(),
      trend: vi.fn(async () => ({ points: [] })),
      apiKeys: {
        ...actual.clientApi.apiKeys,
        list: vi.fn(async () => ({ keys: [] })),
      },
    },
  };
});

const { clientApi, ClientApiError } = clientApiModule;
const scansMock = vi.mocked(clientApi.scans);

const session: SessionResult = {
  user: { id: 'user-1', name: 'Tibor Dev', email: 'dev@example.com', avatar_url: '' },
  organization: {
    id: 'org-1',
    name: 'acme',
    billing_plan: 'free',
    created_at: '2026-06-21T00:00:00Z',
  },
  repositories: [
    {
      id: '11000000-0000-4000-8000-000000000001',
      organization_id: 'org-1',
      name: 'vercel/chatbot',
      github_repo_id: 42,
      is_active: true,
      created_at: '2026-06-21T00:00:00Z',
    },
    {
      id: '11000000-0000-4000-8000-000000000002',
      organization_id: 'org-1',
      name: 'tibco87/ShipReady',
      github_repo_id: 43,
      is_active: true,
      created_at: '2026-06-21T00:00:00Z',
    },
  ],
};

beforeEach(() => {
  __resetScansQueryCacheForTests();
  __resetUnauthorizedSessionForTests();
  scansMock.mockReset();
  scansMock.mockRejectedValue(
    new ClientApiError('Authentication is required.', 401, 'unauthorized'),
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});

  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetUnauthorizedSessionForTests();
});

describe('session expiry re-auth chrome', () => {
  it('replaces the logged-in dashboard with sign-in chrome on a 401', async () => {
    render(
      <DashboardClient initialSession={session} loginUrl="http://localhost:3000/api/auth/login" />,
    );

    expect(screen.getByText('Tibor Dev')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText(SESSION_EXPIRED_MESSAGE)).toBeTruthy();
    });

    expect(screen.queryByText('Tibor Dev')).toBeNull();
    expect(document.querySelector('.dashboard-page')).toBeNull();
    expect(screen.queryByTestId('scan-error-panel')).toBeNull();
    expect(screen.queryByRole('button', { name: /select repository/i })).toBeNull();
    expect(screen.getByRole('link', { name: /sign in with github/i }).getAttribute('href')).toBe(
      'http://localhost:3000/api/auth/login',
    );
    expect(document.querySelector('.unauth-grid')).toBeTruthy();
  });
});
