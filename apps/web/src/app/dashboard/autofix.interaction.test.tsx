// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

// Keep ClientApiError and all other real exports intact; only replace the three
// network methods exercised by the auto-fix flow so `instanceof ClientApiError`
// resolves to the genuine class inside the component.
vi.mock('../../utils/clientApi', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof clientApiModule;
  return {
    ...actual,
    clientApi: {
      ...actual.clientApi,
      scans: vi.fn(),
      findings: vi.fn(),
      createFix: vi.fn(),
    },
  };
});

const { clientApi, ClientApiError } = clientApiModule;
const scansMock = vi.mocked(clientApi.scans);
const findingsMock = vi.mocked(clientApi.findings);
const createFixMock = vi.mocked(clientApi.createFix);

const FIX_PR_URL = 'https://github.com/acme/app/pull/42';

const SESSION: SessionResult = {
  user: { id: 'user-1', name: 'Dev User', email: 'dev@example.com', avatar_url: '' },
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
      name: 'acme/app',
      github_repo_id: 42,
      is_active: true,
      created_at: '2026-06-21T00:00:00Z',
    },
  ],
};

const PERSISTED_SCAN: Scan = {
  id: '22000000-0000-4000-8000-000000000002',
  repository_id: SESSION.repositories[0].id,
  commit_sha: 'abc1234',
  branch: 'main',
  status: 'failed',
  error_count: 1,
  warning_count: 0,
  created_at: '2026-06-22T10:00:00.000Z',
};

/** A finding that passes the `isFindingFixable` gate (SQL + RLS keyword). */
const RLS_FINDING: ScanFinding = {
  id: 'f-1',
  scan_id: PERSISTED_SCAN.id,
  rule_id: 'rls-check',
  severity: 'error',
  file_path: 'db/schema.sql',
  line_number: 1,
  message: "Table 'users' is created without Row-Level Security enabled.",
  suggestion: 'Enable RLS: ALTER TABLE users ENABLE ROW LEVEL SECURITY;',
  created_at: PERSISTED_SCAN.created_at,
};

const FIX_FINDING_IDS = [RLS_FINDING.id];

/** Expands the collapsible detailed findings panel rendered below Ship Gate. */
async function revealDetailedFindings(): Promise<void> {
  fireEvent.click(await screen.findByTestId('scan-findings-details-toggle'));
}

/** RLS also appears in Ship Gate labels; scope assertions to the findings panel. */
async function expectRlsFindingInDetails(): Promise<void> {
  const panel = await screen.findByTestId('scan-details-findings');
  expect(await within(panel).findByText(/row-level security/i)).toBeTruthy();
}

/** Renders the dashboard with a single persisted scan and a fixable finding,
 *  then waits until the "Create Fix PR" button is visible. */
async function renderWithFixableFinding(): Promise<void> {
  scansMock.mockResolvedValue({ scans: [PERSISTED_SCAN] });
  findingsMock.mockResolvedValue({ findings: [RLS_FINDING] });
  render(<DashboardClient initialSession={SESSION} />);
  await revealDetailedFindings();
  await screen.findByRole('button', { name: /create fix pr/i });
}

beforeEach(() => {
  scansMock.mockReset();
  findingsMock.mockReset();
  createFixMock.mockReset();

  vi.spyOn(console, 'error').mockImplementation(() => {});

  // jsdom's localStorage is unreliable across tests; provide a clean stub.
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
  vi.restoreAllMocks();
});

describe('Auto-fix PR — handleCreateFixPr', () => {
  it('shows an English info toast while the fix request is in flight', async () => {
    // The promise never settles so the loading state persists throughout the assertion.
    createFixMock.mockImplementation(() => new Promise(() => {}));

    await renderWithFixableFinding();
    fireEvent.click(screen.getByRole('button', { name: /create fix pr/i }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/creating fix branch and pull request/i);
  });

  it('replaces the "Create Fix PR" button with a "View Fix PR" link on success', async () => {
    createFixMock.mockResolvedValue({ prUrl: FIX_PR_URL, findingIds: FIX_FINDING_IDS });

    await renderWithFixableFinding();
    fireEvent.click(screen.getByRole('button', { name: /create fix pr/i }));

    const link = await screen.findByRole('link', { name: /view fix pr/i });
    expect(link.getAttribute('href')).toBe(FIX_PR_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.queryByRole('button', { name: /create fix pr/i })).toBeNull();
  });

  it('shows an English success toast after the PR is created', async () => {
    createFixMock.mockResolvedValue({ prUrl: FIX_PR_URL, findingIds: FIX_FINDING_IDS });

    await renderWithFixableFinding();
    fireEvent.click(screen.getByRole('button', { name: /create fix pr/i }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/pull request created successfully/i);
  });

  it('calls createFix with the exact repo, scan, and finding IDs', async () => {
    createFixMock.mockResolvedValue({ prUrl: FIX_PR_URL, findingIds: FIX_FINDING_IDS });

    await renderWithFixableFinding();
    fireEvent.click(screen.getByRole('button', { name: /create fix pr/i }));

    await waitFor(() => expect(createFixMock).toHaveBeenCalledTimes(1));
    expect(createFixMock).toHaveBeenCalledWith({
      repoId: SESSION.repositories[0].id,
      scanId: PERSISTED_SCAN.id,
      findingId: RLS_FINDING.id,
    });
  });

  it('surfaces the API error message in the toast when createFix fails with ClientApiError', async () => {
    createFixMock.mockRejectedValue(
      new ClientApiError('GitHub rate limit exceeded.', 429, 'rate_limited'),
    );

    await renderWithFixableFinding();
    fireEvent.click(screen.getByRole('button', { name: /create fix pr/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('GitHub rate limit exceeded.');
  });

  it('forwards the error message for generic Error instances', async () => {
    createFixMock.mockRejectedValue(new Error('network timeout'));

    await renderWithFixableFinding();
    fireEvent.click(screen.getByRole('button', { name: /create fix pr/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('network timeout');
  });

  it('falls back to "Auto-fix failed." for non-Error thrown values', async () => {
    createFixMock.mockRejectedValue('unexpected non-error object');

    await renderWithFixableFinding();
    fireEvent.click(screen.getByRole('button', { name: /create fix pr/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/auto-fix failed\./i);
  });

  it('shows an error toast when the backend returns no PR URL', async () => {
    createFixMock.mockResolvedValue({ prUrl: undefined });

    await renderWithFixableFinding();
    fireEvent.click(screen.getByRole('button', { name: /create fix pr/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/failed to retrieve the pr url/i);
  });

  it('keeps other fix buttons enabled while one fix is pending', async () => {
    // Two distinct fixable findings for the same scan.
    const rls2: ScanFinding = {
      ...RLS_FINDING,
      id: 'f-2',
      file_path: 'db/orders.sql',
      message: "Table 'orders' is created without Row-Level Security enabled.",
    };
    scansMock.mockResolvedValue({ scans: [PERSISTED_SCAN] });
    findingsMock.mockResolvedValue({ findings: [RLS_FINDING, rls2] });
    createFixMock.mockImplementation(() => new Promise(() => {}));

    render(<DashboardClient initialSession={SESSION} />);

    const buttons = await screen.findAllByRole('button', { name: /create fix pr/i });
    expect(buttons).toHaveLength(2);

    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /fixing/i })).toBeTruthy();
      const idle = screen.getAllByRole('button', { name: /create fix pr/i });
      expect(idle).toHaveLength(1);
      expect((idle[0] as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('restores the button to an idle state after an error (no permanent Fixing... spinner)', async () => {
    createFixMock.mockRejectedValue(new Error('server error'));

    await renderWithFixableFinding();
    fireEvent.click(screen.getByRole('button', { name: /create fix pr/i }));

    // After the error resolves the button must return to its clickable idle state.
    await screen.findByRole('button', { name: /create fix pr/i });
  });

  it('does not display a "Create Fix PR" button for warning-severity findings', async () => {
    const warnFinding: ScanFinding = {
      ...RLS_FINDING,
      id: 'f-warn',
      severity: 'warning',
    };
    scansMock.mockResolvedValue({ scans: [PERSISTED_SCAN] });
    findingsMock.mockResolvedValue({ findings: [warnFinding] });

    render(<DashboardClient initialSession={SESSION} />);

    await revealDetailedFindings();
    await expectRlsFindingInDetails();
    expect(screen.queryByRole('button', { name: /create fix pr/i })).toBeNull();
  });

  it('hides "Create Fix PR" for client-generated findings that lack a persisted id', async () => {
    // An otherwise-fixable RLS error whose id is client-generated (`find-...`),
    // as happens for the in-session overflow beyond the persistence cap. The
    // backend would reject its non-UUID id, so the action must not be offered.
    const overflowFinding: ScanFinding = {
      ...RLS_FINDING,
      id: 'find-101-ab12c',
    };
    scansMock.mockResolvedValue({ scans: [PERSISTED_SCAN] });
    findingsMock.mockResolvedValue({ findings: [overflowFinding] });

    render(<DashboardClient initialSession={SESSION} />);

    await revealDetailedFindings();
    await expectRlsFindingInDetails();
    expect(screen.queryByRole('button', { name: /create fix pr/i })).toBeNull();
  });
});
