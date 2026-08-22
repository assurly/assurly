// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DashboardClient from './_components/DashboardClient';
import { installDashboardLocalStorageMock } from './testUtils/installDashboardLocalStorageMock';
import { openDashboardAppView } from './testUtils/openDashboardAppView';
import * as clientApiModule from '../../utils/clientApi';
import type { Scan, ScanFinding } from '../../utils/dbAdapter';
import { __resetScansQueryCacheForTests } from '../../utils/scansQueryCache';

type SessionResult = clientApiModule.SessionResult;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () =>
    new URLSearchParams({ view: 'app', repo: '11000000-0000-4000-8000-000000000010' }),
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

const attestaScanOlder: Scan = {
  id: '22000000-0000-4000-8000-000000000001',
  repository_id: attestaRepo.id,
  commit_sha: '1111111111111111111111111111111111111111',
  branch: 'main',
  status: 'failed',
  error_count: 1,
  warning_count: 0,
  created_at: '2026-06-26T08:00:00Z',
};

const attestaScanLatest: Scan = {
  id: '22000000-0000-4000-8000-000000000002',
  repository_id: attestaRepo.id,
  commit_sha: '2222222222222222222222222222222222222222',
  branch: 'main',
  status: 'failed',
  error_count: 2,
  warning_count: 0,
  created_at: '2026-06-26T09:00:00Z',
};

const olderFindings: ScanFinding[] = [
  {
    id: 'finding-old',
    scan_id: attestaScanOlder.id,
    rule_id: 'supabase-rls',
    severity: 'error',
    file_path: 'db/old.sql',
    line_number: 1,
    message: 'Older scan RLS finding should never flash on the latest scan.',
    created_at: attestaScanOlder.created_at,
  },
];

const latestFindings: ScanFinding[] = [
  {
    id: 'finding-new',
    scan_id: attestaScanLatest.id,
    rule_id: 'client-secret-leak',
    severity: 'error',
    file_path: 'src/config.ts',
    line_number: 4,
    message: 'Latest scan leak finding.',
    created_at: attestaScanLatest.created_at,
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
  __resetScansQueryCacheForTests();
  installDashboardLocalStorageMock();
  scansMock.mockReset();
  findingsMock.mockReset();
  scansMock.mockResolvedValue({ scans: [attestaScanLatest, attestaScanOlder] });

  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Stale scan findings guard', () => {
  it('does not flash previous scan findings while the newly selected scan is loading', async () => {
    let resolveOlderFindings: ((value: { findings: ScanFinding[] }) => void) | undefined;
    findingsMock.mockImplementation(async (scanId: string) => {
      if (scanId === attestaScanLatest.id) {
        return { findings: latestFindings };
      }
      if (scanId === attestaScanOlder.id) {
        return await new Promise((resolve) => {
          resolveOlderFindings = resolve;
        });
      }
      return { findings: [] };
    });

    render(<DashboardClient initialSession={session} />);
    openDashboardAppView(attestaRepo.name);

    await waitFor(() => expect(findingsMock).toHaveBeenCalledWith(attestaScanLatest.id));
    await screen.findByText('NOT READY TO SHIP');
    fireEvent.click(screen.getByTestId('scan-findings-details-toggle'));
    await screen.findByTestId('scan-finding-card-finding-new');

    fireEvent.click(screen.getByTestId('scan-history-chip-22000000-0000-4000-8000-000000000001'));

    expect(screen.queryByTestId('scan-details-findings')).toBeNull();
    expect(screen.queryByTestId('scan-finding-card-finding-new')).toBeNull();

    resolveOlderFindings?.({ findings: olderFindings });
    await screen.findByTestId('scan-finding-card-finding-old');
    expect(screen.queryByTestId('scan-finding-card-finding-new')).toBeNull();
  });
});
