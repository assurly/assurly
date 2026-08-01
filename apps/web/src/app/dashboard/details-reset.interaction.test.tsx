// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DashboardClient from './_components/DashboardClient';
import { installDashboardLocalStorageMock } from './testUtils/installDashboardLocalStorageMock';
import * as clientApiModule from '../../utils/clientApi';
import type { Scan, ScanFinding } from '../../utils/dbAdapter';
import { __resetScansQueryCacheForTests } from '../../utils/scansQueryCache';

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

const scanA: Scan = {
  id: '22000000-0000-4000-8000-000000000001',
  repository_id: attestaRepo.id,
  commit_sha: '1111111111111111111111111111111111111111',
  branch: 'main',
  status: 'failed',
  error_count: 1,
  warning_count: 0,
  created_at: '2026-06-26T08:00:00Z',
};

const scanB: Scan = {
  id: '22000000-0000-4000-8000-000000000002',
  repository_id: attestaRepo.id,
  commit_sha: '2222222222222222222222222222222222222222',
  branch: 'main',
  status: 'failed',
  error_count: 2,
  warning_count: 0,
  created_at: '2026-06-26T09:00:00Z',
};

const findingsA: ScanFinding[] = [
  {
    id: 'finding-a',
    scan_id: scanA.id,
    rule_id: 'supabase-rls',
    severity: 'error',
    file_path: 'db/a.sql',
    line_number: 1,
    message: 'Scan A detailed finding message.',
    created_at: scanA.created_at,
  },
];

const findingsB: ScanFinding[] = [
  {
    id: 'finding-b',
    scan_id: scanB.id,
    rule_id: 'client-secret-leak',
    severity: 'error',
    file_path: 'src/b.ts',
    line_number: 2,
    message: 'Scan B detailed finding message.',
    created_at: scanB.created_at,
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
  scansMock.mockResolvedValue({ scans: [scanB, scanA] });
  findingsMock.mockImplementation(async (scanId: string) => {
    if (scanId === scanA.id) return { findings: findingsA };
    if (scanId === scanB.id) return { findings: findingsB };
    return { findings: [] };
  });

  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Show details reset', () => {
  it('collapses Show details when switching to another scan in history', async () => {
    render(<DashboardClient initialSession={session} />);

    await waitFor(() => expect(findingsMock).toHaveBeenCalledWith(scanB.id));
    await screen.findByTestId('scan-details-findings');

    fireEvent.click(screen.getByTestId('scan-findings-details-toggle'));
    expect((screen.getByTestId('scan-details-findings') as HTMLDetailsElement).open).toBe(true);
    const detailsPanel = screen.getByTestId('scan-details-findings');
    expect(within(detailsPanel).getByText('Scan B detailed finding message.')).toBeTruthy();

    fireEvent.click(screen.getByTestId('scan-history-chip-22000000-0000-4000-8000-000000000001'));

    await waitFor(() => expect(findingsMock).toHaveBeenCalledWith(scanA.id));
    const resetDetails = screen.getByTestId('scan-details-findings') as HTMLDetailsElement;
    expect(resetDetails.open).toBe(false);

    fireEvent.click(screen.getByTestId('scan-findings-details-toggle'));
    expect(within(resetDetails).getByText('Scan A detailed finding message.')).toBeTruthy();
    expect(within(resetDetails).queryByText('Scan B detailed finding message.')).toBeNull();
  });
});
