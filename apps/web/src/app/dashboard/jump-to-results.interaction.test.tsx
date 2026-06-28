// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DashboardClient from './_components/DashboardClient';
import * as clientApiModule from '../../utils/clientApi';
import { SCAN_DETAILS_CONTAINER_ID } from '../../utils/scrollToScanDetails';
import type { Scan, ScanFinding } from '../../utils/dbAdapter';

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
      scans: vi.fn(),
      saveScan: vi.fn(),
      findings: vi.fn(),
    },
  };
});

const { clientApi } = clientApiModule;
const scansMock = vi.mocked(clientApi.scans);
const findingsMock = vi.mocked(clientApi.findings);

const attestaRepo = {
  id: '11000000-0000-4000-8000-000000000010',
  organization_id: 'org-1',
  name: 'tibco87/Attesta',
  github_repo_id: 101,
  is_active: true,
  created_at: '2026-06-21T00:00:00Z',
};

const attestaScan: Scan = {
  id: '22000000-0000-4000-8000-000000000010',
  repository_id: attestaRepo.id,
  commit_sha: '669c0392ea81119689959fdbe63b05c3c95ce544',
  branch: 'main',
  status: 'failed',
  error_count: 7,
  warning_count: 1,
  created_at: '2026-06-26T08:55:00Z',
};

const attestaFindings: ScanFinding[] = [
  {
    id: 'finding-rls',
    scan_id: attestaScan.id,
    rule_id: 'supabase-rls',
    severity: 'error',
    file_path: 'db/migrations/003_create_auth_schema.up.sql',
    line_number: 1,
    message:
      "Supabase table 'organizations' is created but Row-Level Security (RLS) is not enabled.",
    created_at: attestaScan.created_at,
  },
];

const session: SessionResult = {
  user: { id: 'user-1', name: 'Tibor Dev', email: 'dev@example.com', avatar_url: '' },
  organization: {
    id: 'org-1',
    name: 'acme',
    billing_plan: 'pro',
    github_installation_id: '140302856',
    created_at: '2026-06-21T00:00:00Z',
  },
  repositories: [attestaRepo],
};

beforeEach(() => {
  scansMock.mockReset();
  findingsMock.mockReset();

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

  scansMock.mockResolvedValue({ scans: [attestaScan] });
  findingsMock.mockResolvedValue({ findings: attestaFindings });

  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Selected repo header jump navigation', () => {
  it('scrolls the scan details container into view when Jump to results is clicked', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    render(<DashboardClient initialSession={session} />);

    await waitFor(() => expect(scansMock).toHaveBeenCalledWith(attestaRepo.id));
    const header = await screen.findByTestId('selected-repo-header');
    expect(within(header).getByRole('heading', { name: attestaRepo.name })).toBeTruthy();
    expect(within(header).getByText('1 scan')).toBeTruthy();

    const jumpButton = await screen.findByRole('button', { name: /jump to results/i });
    scrollIntoView.mockClear();
    fireEvent.click(jumpButton);

    const target = document.getElementById(SCAN_DETAILS_CONTAINER_ID);
    expect(target).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('hides Jump to results while scan details are still loading', async () => {
    findingsMock.mockReset();
    let resolveFindings: ((value: { findings: ScanFinding[] }) => void) | undefined;
    findingsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFindings = resolve;
        }),
    );

    render(<DashboardClient initialSession={session} />);

    const header = await screen.findByTestId('selected-repo-header');
    expect(within(header).getByRole('heading', { name: attestaRepo.name })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /jump to results/i })).toBeNull();

    await waitFor(() => expect(findingsMock).toHaveBeenCalled());
    resolveFindings?.({ findings: attestaFindings });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /jump to results/i })).toBeTruthy();
    });
  });
});
