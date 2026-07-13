// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DashboardClient from './_components/DashboardClient';
import { installDashboardLocalStorageMock } from './testUtils/installDashboardLocalStorageMock';
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

const leaksScan: Scan = {
  id: '22000000-0000-4000-8000-000000000011',
  repository_id: leaksRepo.id,
  commit_sha: 'aabbccddeeff00112233445566778899aabbccdd',
  branch: 'main',
  status: 'failed',
  error_count: 1,
  warning_count: 0,
  created_at: '2026-06-26T09:10:00Z',
};

const attestaFindings: ScanFinding[] = [
  {
    id: 'finding-rls',
    scan_id: attestaScan.id,
    rule_id: 'supabase-rls',
    severity: 'error',
    file_path: 'db/schema.sql',
    line_number: 1,
    message:
      "Supabase table 'organizations' is created but Row-Level Security (RLS) is not enabled.",
    created_at: attestaScan.created_at,
  },
];

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
  repositories: [attestaRepo, leaksRepo],
};

beforeEach(() => {
  installDashboardLocalStorageMock();
  scansMock.mockReset();
  findingsMock.mockReset();

  scansMock.mockImplementation(async (repoId: string) => {
    if (repoId === attestaRepo.id) return { scans: [attestaScan] };
    if (repoId === leaksRepo.id) return { scans: [leaksScan] };
    return { scans: [] };
  });
  findingsMock.mockImplementation(async (scanId: string) => {
    if (scanId === attestaScan.id) return { findings: attestaFindings };
    if (scanId === leaksScan.id) return { findings: leaksFindings };
    return { findings: [] };
  });

  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Repository filter integration', () => {
  it('filters the repo list and selects a matching repository from the narrowed results', async () => {
    render(<DashboardClient initialSession={session} />);

    await waitFor(() => expect(scansMock).toHaveBeenCalledWith(attestaRepo.id));
    await screen.findByText('NOT READY TO SHIP');

    fireEvent.change(screen.getByTestId('repo-list-filter'), {
      target: { value: 'leaks' },
    });

    const list = screen.getByTestId('repo-list-panel');
    expect(list.querySelectorAll('button')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /select repository react-client-leaks/i }));

    await waitFor(() => expect(scansMock).toHaveBeenCalledWith(leaksRepo.id));
    await within(screen.getByTestId('selected-repo-header')).findByRole('heading', {
      name: leaksRepo.name,
    });
    expect(screen.queryByText(/organizations.*Row-Level Security/i)).toBeNull();
    await waitFor(() => {
      expect(screen.getAllByText(/Possible API key exposed/i).length).toBeGreaterThan(0);
    });
  });
});
