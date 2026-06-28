// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DashboardClient from './_components/DashboardClient';
import * as clientApiModule from '../../utils/clientApi';
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

const leaksRepo = {
  id: '11000000-0000-4000-8000-000000000011',
  organization_id: 'org-1',
  name: 'react-client-leaks',
  github_repo_id: 102,
  is_active: true,
  created_at: '2026-06-21T00:00:00Z',
};

const emptyRepo = {
  id: '11000000-0000-4000-8000-000000000012',
  organization_id: 'org-1',
  name: 'empty-repo',
  github_repo_id: 103,
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

const leaksScan: Scan = {
  id: '22000000-0000-4000-8000-000000000011',
  repository_id: leaksRepo.id,
  commit_sha: 'aabbccddeeff00112233445566778899aabbccdd',
  branch: 'main',
  status: 'failed',
  error_count: 2,
  warning_count: 0,
  created_at: '2026-06-26T09:10:00Z',
};

const leaksFindings: ScanFinding[] = [
  {
    id: 'finding-leak',
    scan_id: leaksScan.id,
    rule_id: 'client-secret-leak',
    severity: 'error',
    file_path: 'src/config.ts',
    line_number: 12,
    message: 'Possible API key exposed in client-side bundle.',
    created_at: leaksScan.created_at,
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
  repositories: [attestaRepo, leaksRepo, emptyRepo],
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

  scansMock.mockImplementation(async (repoId: string) => {
    if (repoId === attestaRepo.id) {
      return { scans: [attestaScan] };
    }
    if (repoId === leaksRepo.id) {
      return { scans: [leaksScan] };
    }
    return { scans: [] };
  });
  findingsMock.mockImplementation(async (scanId: string) => {
    if (scanId === attestaScan.id) {
      return { findings: attestaFindings };
    }
    if (scanId === leaksScan.id) {
      return { findings: leaksFindings };
    }
    return { findings: [] };
  });

  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Repository selection state machine', () => {
  it('clears stale scan panel immediately when switching repositories', async () => {
    render(<DashboardClient initialSession={session} />);

    await waitFor(() => expect(scansMock).toHaveBeenCalledWith(attestaRepo.id));
    expect(await screen.findByText('NOT READY TO SHIP')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /empty-repo/i }));

    expect(screen.queryByText('NOT READY TO SHIP')).toBeNull();
    expect(screen.queryByText(/organizations.*Row-Level Security/i)).toBeNull();
    expect(screen.getByTestId('scan-details-skeleton')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('No scans found for this repository')).toBeTruthy();
    });
    expect(screen.queryByTestId('scan-details-skeleton')).toBeNull();
  });

  it('collapses Show details when switching to another repository scan', async () => {
    render(<DashboardClient initialSession={session} />);

    await waitFor(() => expect(scansMock).toHaveBeenCalledWith(attestaRepo.id));
    expect(await screen.findByTestId('scan-details-findings')).toBeTruthy();

    fireEvent.click(screen.getByTestId('scan-findings-details-toggle'));
    expect((screen.getByTestId('scan-details-findings') as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByText(/organizations.*Row-Level Security/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /react-client-leaks/i }));

    await waitFor(() => expect(scansMock).toHaveBeenCalledWith(leaksRepo.id));
    expect(await screen.findByText('NOT READY TO SHIP')).toBeTruthy();

    expect((screen.getByTestId('scan-details-findings') as HTMLDetailsElement).open).toBe(false);
    expect(screen.queryByText(/organizations.*Row-Level Security/i)).toBeNull();
  });
});
