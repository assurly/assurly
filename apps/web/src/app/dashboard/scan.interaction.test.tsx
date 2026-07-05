// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DashboardClient from './_components/DashboardClient';
import { getScanDetailsSectionOrder } from './_components/ScanDetailsPanel';
import * as clientApiModule from '../../utils/clientApi';
import type { Organization, Scan, ScanFinding } from '../../utils/dbAdapter';

type SessionResult = clientApiModule.SessionResult;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('./_components/manual-checker/ManualChecker', () => ({
  default: () => null,
}));

// Keep the real module (ClientApiError, githubApi, schemas) and only spy on the
// three network methods the scan flow depends on.
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

const { clientApi, ClientApiError } = clientApiModule;
const scansMock = vi.mocked(clientApi.scans);
const saveScanMock = vi.mocked(clientApi.saveScan);
const findingsMock = vi.mocked(clientApi.findings);

const RLS_FINDING_TEXT = /Row-Level Security/i;

async function revealDetailedFindings(): Promise<void> {
  fireEvent.click(await screen.findByTestId('scan-findings-details-toggle'));
}

/** RLS also appears in Ship Gate labels; scope assertions to the findings panel. */
async function expectRlsFindingInDetails(): Promise<void> {
  const panel = await screen.findByTestId('scan-details-findings');
  expect(await within(panel).findByText(RLS_FINDING_TEXT)).toBeTruthy();
}

function assertRlsFindingInDetails(): void {
  const panel = screen.getByTestId('scan-details-findings');
  expect(within(panel).getByText(RLS_FINDING_TEXT)).toBeTruthy();
}
const CI_FINDING_TEXT = /GitHub Actions workflow for ShipReady is missing/i;

const baseOrganization: Organization = {
  id: 'org-1',
  name: 'acme',
  billing_plan: 'free',
  created_at: '2026-06-21T00:00:00Z',
};

const session: SessionResult = {
  user: { id: 'user-1', name: 'Tibor Dev', email: 'dev@example.com', avatar_url: '' },
  organization: baseOrganization,
  // A public repo (owner/name) so the scanner uses the server-side public-scan proxy.
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

const TABLE_WITHOUT_RLS = 'CREATE TABLE users (id uuid PRIMARY KEY);';

/** Builds a fetch stub that serves a GitHub tree and per-file contents. */
function stubGitHubFetch(
  tree: { path: string; type: string }[],
  files: Record<string, string>,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('type=tree')) {
        return new Response(JSON.stringify({ default_branch: 'main', tree }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('type=file')) {
        const path = decodeURIComponent(
          new URL(url, 'http://localhost').searchParams.get('path') ?? '',
        );
        return new Response(files[path] ?? '', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }),
  );
}

function runScan(): void {
  fireEvent.click(screen.getByRole('button', { name: /run secure scan/i }));
}

beforeEach(() => {
  scansMock.mockReset();
  saveScanMock.mockReset();
  findingsMock.mockReset();

  // Default: the repository has no persisted scans (also the post-failure reality).
  scansMock.mockResolvedValue({ scans: [] });
  findingsMock.mockResolvedValue({ findings: [] });

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
});

describe('Run Secure Scan results rendering', () => {
  it('keeps results visible and reports an honest error when persistence fails', async () => {
    stubGitHubFetch([{ path: 'db/schema.sql', type: 'blob' }], {
      'db/schema.sql': TABLE_WITHOUT_RLS,
    });
    // Simulate the production failure: missing env / origin mismatch on the CSRF check.
    saveScanMock.mockRejectedValue(
      new ClientApiError('Service is unavailable.', 503, 'service_unavailable'),
    );

    render(<DashboardClient initialSession={session} />);
    runScan();

    // The computed result is shown despite the save failing.
    await revealDetailedFindings();
    await expectRlsFindingInDetails();
    expect(screen.getAllByText(CI_FINDING_TEXT).length).toBeGreaterThan(0);

    // The user is told the truth instead of seeing a fake success.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be saved/i);
    expect(alert.textContent).toContain('Service is unavailable.');

    // The button returns to its idle label (no permanent "Scanning..." state).
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /run secure scan/i }).textContent).toMatch(
        /run secure scan/i,
      ),
    );
  });

  it('does not let background polling erase a freshly computed local result', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubGitHubFetch([{ path: 'db/schema.sql', type: 'blob' }], {
        'db/schema.sql': TABLE_WITHOUT_RLS,
      });
      saveScanMock.mockRejectedValue(
        new ClientApiError('Service is unavailable.', 503, 'service_unavailable'),
      );

      render(<DashboardClient initialSession={session} />);
      runScan();

      await revealDetailedFindings();
      await expectRlsFindingInDetails();
      const pollsBefore = scansMock.mock.calls.length;

      // Advance beyond the 5s polling interval so a server reconciliation runs.
      await vi.advanceTimersByTimeAsync(6000);
      expect(scansMock.mock.calls.length).toBeGreaterThan(pollsBefore);

      // The polling returns an empty list, but the local result must survive.
      assertRlsFindingInDetails();
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists and displays the scan when saving succeeds', async () => {
    stubGitHubFetch([{ path: 'db/schema.sql', type: 'blob' }], {
      'db/schema.sql': TABLE_WITHOUT_RLS,
    });

    const savedScan: Scan = {
      id: '22000000-0000-4000-8000-000000000002',
      repository_id: session.repositories[0].id,
      commit_sha: 'deadbee',
      branch: 'main',
      status: 'failed',
      error_count: 1,
      warning_count: 1,
      created_at: '2026-06-22T10:00:00.000Z',
    };
    const savedFindings: ScanFinding[] = [
      {
        id: 'f-1',
        scan_id: savedScan.id,
        rule_id: 'rls-check',
        severity: 'error',
        file_path: 'db/schema.sql',
        line_number: 1,
        message: "Table 'users' is created without Row-Level Security enabled.",
        suggestion: 'Enable RLS.',
        created_at: savedScan.created_at,
      },
    ];
    saveScanMock.mockResolvedValue(savedScan);
    findingsMock.mockResolvedValue({ findings: savedFindings });

    render(<DashboardClient initialSession={session} />);
    runScan();

    await waitFor(() => expect(saveScanMock).toHaveBeenCalledTimes(1));
    // The scan found 1 error, so the confirmation toast is an error-styled alert.
    const toast = await screen.findByRole('alert');
    expect(toast.textContent).toMatch(/saved/i);
    fireEvent.click(await screen.findByTestId('scan-findings-details-toggle'));
    await expectRlsFindingInDetails();
    expect(findingsMock).toHaveBeenCalledWith(savedScan.id);
  });

  it('renders Ship Gate before auto-fix summary and detailed findings', async () => {
    stubGitHubFetch([{ path: 'db/schema.sql', type: 'blob' }], {
      'db/schema.sql': TABLE_WITHOUT_RLS,
    });

    const savedScan: Scan = {
      id: '22000000-0000-4000-8000-000000000002',
      repository_id: session.repositories[0].id,
      commit_sha: 'deadbee',
      branch: 'main',
      status: 'failed',
      error_count: 1,
      warning_count: 1,
      created_at: '2026-06-22T10:00:00.000Z',
    };
    saveScanMock.mockResolvedValue(savedScan);
    findingsMock.mockResolvedValue({
      findings: [
        {
          id: 'f-1',
          scan_id: savedScan.id,
          rule_id: 'rls-check',
          severity: 'error',
          file_path: 'db/schema.sql',
          line_number: 1,
          message: "Table 'users' is created without Row-Level Security enabled.",
          created_at: savedScan.created_at,
        },
      ],
    });

    render(<DashboardClient initialSession={session} />);
    runScan();

    await waitFor(() => expect(saveScanMock).toHaveBeenCalledTimes(1));
    const container = await screen.findByTestId('scan-details-container');

    await waitFor(() => {
      const order = getScanDetailsSectionOrder(container);
      expect(order[0]).toBe('ship-gate');
      expect(order.indexOf('ship-gate')).toBeLessThan(order.indexOf('fix-summary'));
      expect(order.indexOf('fix-summary')).toBeLessThan(order.indexOf('findings'));
    });
  });

  it('never sends more findings than the API allows and keeps counts consistent', async () => {
    // 120 SQL files, each producing exactly one RLS error → 120 errors + 1 CI warning.
    const tree = Array.from({ length: 120 }, (_, i) => ({ path: `db/m_${i}.sql`, type: 'blob' }));
    const files = Object.fromEntries(tree.map((node) => [node.path, TABLE_WITHOUT_RLS]));
    stubGitHubFetch(tree, files);
    saveScanMock.mockResolvedValue({
      id: '22000000-0000-4000-8000-000000000002',
      repository_id: session.repositories[0].id,
      commit_sha: 'deadbee',
      branch: 'main',
      status: 'failed',
      error_count: 100,
      warning_count: 0,
      created_at: '2026-06-22T10:00:00.000Z',
    });

    render(<DashboardClient initialSession={session} />);
    runScan();

    await waitFor(() => expect(saveScanMock).toHaveBeenCalledTimes(1));
    const payload = saveScanMock.mock.calls[0][0];
    expect(payload.findings.length).toBeLessThanOrEqual(100);
    expect(payload.findings.length).toBe(100);
    // Counts must match exactly what is sent, or the API rejects the write.
    expect(payload.errors + payload.warnings).toBe(payload.findings.length);
    const actualErrors = payload.findings.filter((f) => f.severity === 'error').length;
    const actualWarnings = payload.findings.filter((f) => f.severity === 'warning').length;
    expect(payload.errors).toBe(actualErrors);
    expect(payload.warnings).toBe(actualWarnings);
  });

  it('keeps findings beyond the persisted cap visible for the session with a transparency note', async () => {
    // A single migration declaring 120 distinct tables without RLS yields 120
    // errors; the missing-CI-workflow warning brings the total to 121 findings —
    // more than the SAVE_FINDINGS_LIMIT of 100 the API persists.
    const schema = Array.from(
      { length: 120 },
      (_, i) => `CREATE TABLE t_${i} (id uuid PRIMARY KEY);`,
    ).join('\n');
    stubGitHubFetch([{ path: 'db/schema.sql', type: 'blob' }], { 'db/schema.sql': schema });

    const savedScan: Scan = {
      id: '22000000-0000-4000-8000-000000000003',
      repository_id: session.repositories[0].id,
      commit_sha: 'deadbee',
      branch: 'main',
      // The persisted record is intentionally capped at the API limit.
      status: 'failed',
      error_count: 100,
      warning_count: 0,
      created_at: '2026-06-22T10:00:00.000Z',
    };
    // The backend echoes back the 100 persisted findings, each carrying a real
    // database UUID so auto-fix keeps working against the saved scan.
    const persistedFindings: ScanFinding[] = Array.from({ length: 100 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      scan_id: savedScan.id,
      rule_id: 'supabase-rls',
      severity: 'error',
      file_path: 'db/schema.sql',
      line_number: i + 1,
      message: `Supabase table 't_${i}' is created but Row-Level Security (RLS) is not enabled.`,
      suggestion: 'Enable RLS.',
      created_at: savedScan.created_at,
    }));
    saveScanMock.mockResolvedValue(savedScan);
    findingsMock.mockResolvedValue({ findings: persistedFindings });

    render(<DashboardClient initialSession={session} />);
    runScan();

    await waitFor(() => expect(saveScanMock).toHaveBeenCalledTimes(1));

    // Durability contract: never write more than the API allows, and report the
    // true failure even though the persisted slice contains only errors.
    const payload = saveScanMock.mock.calls[0][0];
    expect(payload.findings.length).toBe(100);
    expect(payload.status).toBe('failed');

    // Persisted findings are reloaded by their real ids, keeping auto-fix intact.
    await waitFor(() => expect(findingsMock).toHaveBeenCalledWith(savedScan.id));

    // The fix summary reports the TRUE error total, not the capped 100.
    expect(await screen.findByText(/120 issues detected/i)).toBeTruthy();

    fireEvent.click(await screen.findByTestId('scan-findings-details-toggle'));

    // A transparency note explains that history only stores the first 100.
    const note = await screen.findByRole('note');
    expect(note.textContent).toMatch(/Showing all 121 findings from this run/i);
    expect(note.textContent).toMatch(/first 100/i);

    // The warning sits at position 121 (after the 120 prioritised errors), i.e.
    // beyond the persisted cap — it must remain visible from the in-session set
    // instead of being silently dropped.
    expect(screen.getAllByText(CI_FINDING_TEXT).length).toBeGreaterThan(0);
  });
});

/**
 * P0 regression: the GitHub App proxy used to return an opaque 500 whenever the
 * installation could not access a repository, leaving the dashboard stuck on
 * "No scans found". The proxy now returns a classified error and the client (a)
 * surfaces it and (b) transparently falls back to the public-scan proxy for
 * public "owner/repo" repositories.
 */
describe('Run Secure Scan — installation proxy fallback & error reporting', () => {
  // An organization WITH a GitHub App installation, so the scanner reaches for
  // the authenticated proxy first.
  const installedSession: SessionResult = {
    ...session,
    organization: { ...baseOrganization, github_installation_id: '140302856' },
  };

  /** Routes the GitHub-tree/file calls by endpoint so each proxy can be controlled independently. */
  function stubRoutedFetch(handlers: {
    proxyTree: () => Response;
    publicTree?: () => Response;
    file?: (path: string) => Response;
  }): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const isProxy = url.includes('/api/github/proxy');
      if (url.includes('type=tree')) {
        return isProxy
          ? handlers.proxyTree()
          : (handlers.publicTree?.() ?? new Response('', { status: 502 }));
      }
      if (url.includes('type=file')) {
        const path = decodeURIComponent(
          new URL(url, 'http://localhost').searchParams.get('path') ?? '',
        );
        return handlers.file?.(path) ?? new Response('', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function jsonError(status: number, message: string): Response {
    return new Response(JSON.stringify({ error: { code: 'x', message } }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('falls back to the public-scan proxy when the installation cannot access a public repo', async () => {
    saveScanMock.mockRejectedValue(
      new ClientApiError('Service is unavailable.', 503, 'service_unavailable'),
    );

    const fetchMock = stubRoutedFetch({
      // Installation has no access to this repository.
      proxyTree: () =>
        jsonError(
          404,
          'This repository is not accessible to the ShipReady GitHub App installation.',
        ),
      // But it is a public repo, so the public-scan proxy succeeds.
      publicTree: () =>
        new Response(
          JSON.stringify({
            default_branch: 'main',
            tree: [{ path: 'db/schema.sql', type: 'blob' }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      file: () => new Response(TABLE_WITHOUT_RLS, { status: 200 }),
    });

    render(<DashboardClient initialSession={installedSession} />);
    runScan();

    // The scan completes via the public proxy and renders real findings.
    await revealDetailedFindings();
    await expectRlsFindingInDetails();

    // Both proxies were exercised: private first, public on fallback.
    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls.some((u) => u.includes('/api/github/proxy') && u.includes('type=tree'))).toBe(
      true,
    );
    expect(
      calledUrls.some((u) => u.includes('/api/github/public-scan') && u.includes('type=tree')),
    ).toBe(true);
    // File contents were fetched through the public proxy after the downgrade.
    expect(
      calledUrls.some((u) => u.includes('/api/github/public-scan') && u.includes('type=file')),
    ).toBe(true);
  });

  it('surfaces the structured error message when both proxies reject the repository', async () => {
    const fetchMock = stubRoutedFetch({
      proxyTree: () =>
        jsonError(
          404,
          'This repository is not accessible to the ShipReady GitHub App installation.',
        ),
      publicTree: () =>
        jsonError(
          404,
          'Repository not found. Please verify it is a PUBLIC repository and formatted as "owner/repo".',
        ),
    });

    render(<DashboardClient initialSession={installedSession} />);
    runScan();

    // Primary surface: a persistent in-panel banner (not a fleeting toast).
    const panel = await screen.findByTestId('scan-error-panel');
    expect(panel.textContent).toMatch(/Scan failed/i);
    expect(panel.textContent).toMatch(/Repository not found/i);
    expect(screen.queryByText(/No scans found for this repository/i)).toBeNull();

    // Scan logs stay visible after failure so the terminal-style reason is readable.
    expect(screen.getByText(/❌ ERROR:/i)).toBeTruthy();

    // No persistence is attempted when the tree can never be fetched.
    expect(saveScanMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('keeps the scan error panel visible after the toast auto-dismiss window would have elapsed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubRoutedFetch({
        proxyTree: () =>
          jsonError(
            404,
            'This repository is not accessible to the ShipReady GitHub App installation.',
          ),
        publicTree: () =>
          jsonError(
            404,
            'Repository not found. Please verify it is a PUBLIC repository and formatted as "owner/repo".',
          ),
      });

      render(<DashboardClient initialSession={installedSession} />);
      runScan();

      await screen.findByTestId('scan-error-panel');

      // Legacy behaviour: toast vanished after 4s while the panel showed nothing.
      await vi.advanceTimersByTimeAsync(15000);

      expect(screen.getByTestId('scan-error-panel')).toBeTruthy();
      expect(screen.queryByText(/No scans found for this repository/i)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
