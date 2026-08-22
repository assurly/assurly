// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DashboardClient from './_components/DashboardClient';
import { getScanDetailsSectionOrder } from './_components/ScanDetailsPanel';
import * as clientApiModule from '../../utils/clientApi';
import type { Organization, Scan, ScanFinding } from '../../utils/dbAdapter';
import { __resetScansQueryCacheForTests } from '../../utils/scansQueryCache';
import { openDashboardAppView } from './testUtils/openDashboardAppView';

type SessionResult = clientApiModule.SessionResult;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () =>
    new URLSearchParams({ view: 'app', repo: '11000000-0000-4000-8000-000000000001' }),
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
      targets: vi.fn(async () => ({ targets: [] })),
      scans: vi.fn(),
      saveScan: vi.fn(),
      findings: vi.fn(),
      updateRepositoryScanCapability: vi.fn().mockResolvedValue({}),
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
const CI_FINDING_TEXT = /GitHub Actions workflow for Assurly is missing/i;

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

const TABLE_WITHOUT_RLS = 'CREATE TABLE users (id uuid PRIMARY KEY);\nselect auth.uid();';

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/** Rejects when `signal` aborts; used so hanging stubs honour Stop scan. */
function waitUntilAborted(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    signal?.addEventListener(
      'abort',
      () => {
        reject(abortError());
      },
      { once: true },
    );
  });
}

/** Tree fetch that never resolves unless the caller aborts (or `release` runs). */
function stubHangingGitHubFetch(): { release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal ?? null;
      return Promise.race([
        gate.then(
          () =>
            new Response(JSON.stringify({ default_branch: 'main', tree: [] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
        ),
        waitUntilAborted(signal),
      ]);
    }),
  );
  return { release };
}

/** Builds a fetch stub that serves a GitHub tree and per-file contents. */
function stubGitHubFetch(
  tree: { path: string; type: string }[],
  files: Record<string, string>,
  options: { defaultBranch?: string; branches?: string[] } = {},
): void {
  const defaultBranch = options.defaultBranch ?? 'main';
  const branches = options.branches ?? [defaultBranch];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        throw abortError();
      }
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('type=branches')) {
        return new Response(JSON.stringify({ default_branch: defaultBranch, branches }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('type=tree')) {
        return new Response(JSON.stringify({ default_branch: defaultBranch, tree }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      // Batch file read (public repositories): POST with a list of paths.
      if (init?.method === 'POST' && url.includes('/api/github/public-scan')) {
        const requestedPaths = (JSON.parse(String(init.body ?? '{}')).paths ?? []) as string[];
        return new Response(
          JSON.stringify({
            default_branch: 'main',
            files: requestedPaths.map((path) => ({ path, content: files[path] ?? null })),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
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
  if (!screen.queryByRole('button', { name: /run secure scan/i })) {
    openDashboardAppView();
  }
  fireEvent.click(screen.getByRole('button', { name: /run secure scan/i }));
}

beforeEach(() => {
  __resetScansQueryCacheForTests();
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

  it('offers Scan main instead when the default branch has no scannable files', async () => {
    stubGitHubFetch(
      [{ path: 'LICENSE', type: 'blob' }],
      { LICENSE: 'MIT' },
      {
        defaultBranch: 'src',
        branches: ['src', 'main'],
      },
    );
    saveScanMock.mockResolvedValue({
      id: '22000000-0000-4000-8000-000000000099',
      repository_id: session.repositories[0].id,
      commit_sha: 'unknown',
      branch: 'src',
      status: 'failed',
      error_count: 0,
      warning_count: 0,
      created_at: '2026-08-21T20:00:00.000Z',
    });

    render(<DashboardClient initialSession={session} />);
    runScan();

    await waitFor(() => expect(saveScanMock).toHaveBeenCalledTimes(1));
    const payload = saveScanMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      status: 'failed',
      verdict: 'failed',
      failureReason: 'no_eligible_files',
      findings: [],
    });
    expect(payload.shipScore).toBeUndefined();
    expect(await screen.findByRole('button', { name: /Scan main instead/i })).toBeTruthy();
  });

  it('does not poll /api/scans on an interval while the dashboard sits idle', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<DashboardClient initialSession={session} />);
      await waitFor(() => {
        expect(scansMock).toHaveBeenCalled();
      });
      const callsAfterMount = scansMock.mock.calls.length;

      await vi.advanceTimersByTimeAsync(30_000);

      // Launch P0: no 5s reconcile loop. Idle time must not keep hitting Supabase.
      expect(scansMock.mock.calls.length).toBe(callsAfterMount);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a visibility refresh erase a freshly computed local result', async () => {
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
    const fetchesBefore = scansMock.mock.calls.length;

    // Simulate returning to the tab — forces a server reconcile (empty list).
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => {
      expect(scansMock.mock.calls.length).toBeGreaterThan(fetchesBefore);
    });

    // Server returned empty, but the unsaved local result must survive.
    assertRlsFindingInDetails();
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

  it('admits unread Go backend code, detects nested Next.js + Stripe, and will not claim READY', async () => {
    const tree = [
      { path: 'web/package.json', type: 'blob' },
      { path: 'web/src/app/page.tsx', type: 'blob' },
      { path: 'internal/handler/http/stripe_handler.go', type: 'blob' },
      { path: 'internal/middleware/auth.go', type: 'blob' },
      { path: 'internal/repository/postgres_apikey.go', type: 'blob' },
      { path: '.github/workflows/assurly.yml', type: 'blob' },
      { path: 'LICENSE', type: 'blob' },
    ];
    stubGitHubFetch(tree, {
      'web/package.json': JSON.stringify({
        dependencies: { next: '16.0.0', stripe: '^17.0.0' },
      }),
      'web/src/app/page.tsx': 'export default function Page() { return null; }\n',
      '.github/workflows/assurly.yml': 'run: npx assurly scan\n',
    });
    saveScanMock.mockRejectedValue(
      new ClientApiError('Service is unavailable.', 503, 'service_unavailable'),
    );

    render(<DashboardClient initialSession={session} />);
    runScan();

    await waitFor(() => expect(saveScanMock).toHaveBeenCalledTimes(1));
    const payload = saveScanMock.mock.calls[0][0];
    expect(payload.verdict).toBe('review');
    expect(payload.scanScope).toMatchObject({
      scanned: 1,
      skipped: 3,
      sourceTotal: 4,
      unanalyzed: [{ language: 'Go', fileCount: 3 }],
      gaps: { notAnalysed: 3, overLimit: 0, outsideAppRoots: 0 },
    });
    expect(payload.findings.some((finding) => finding.rule_id === 'scan-language-coverage')).toBe(
      true,
    );
    expect(payload.generatorFingerprint).toBeDefined();

    expect(await screen.findByText('REVIEW RECOMMENDED')).toBeTruthy();
    expect(screen.getByText(/3 Go files not analysed/i)).toBeTruthy();
    expect(screen.getByText('Backend code not analysed')).toBeTruthy();
    expect(screen.queryByText('READY TO SHIP')).toBeNull();
  });

  it('scans .mjs files so they count in the source-file denominator', async () => {
    const tree = [
      { path: 'web/src/app/page.tsx', type: 'blob' },
      { path: 'web/next.config.mjs', type: 'blob' },
      { path: '.github/workflows/assurly.yml', type: 'blob' },
    ];
    stubGitHubFetch(tree, {
      'web/src/app/page.tsx': 'export default function Page() { return null; }\n',
      'web/next.config.mjs': 'export default { reactStrictMode: true };\n',
      '.github/workflows/assurly.yml': 'run: npx assurly scan\n',
    });
    saveScanMock.mockRejectedValue(
      new ClientApiError('Service is unavailable.', 503, 'service_unavailable'),
    );

    render(<DashboardClient initialSession={session} />);
    runScan();

    await waitFor(() => expect(saveScanMock).toHaveBeenCalledTimes(1));
    const payload = saveScanMock.mock.calls[0][0];
    expect(payload.scanScope).toMatchObject({
      scanned: 2,
      skipped: 0,
      sourceTotal: 2,
      gaps: { notAnalysed: 0, overLimit: 0, outsideAppRoots: 0 },
    });
    const batch = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) =>
          String(input).includes('/api/github/public-scan') && init?.method === 'POST',
      );
    expect(batch).toBeDefined();
    const requested = JSON.parse(String(batch?.[1]?.body ?? '{}')).paths as string[];
    expect(requested).toContain('web/next.config.mjs');
  });

  it('never sends more findings than the API allows and keeps counts consistent', async () => {
    // 120 SQL files, each creating a distinct table without RLS → 120 errors + 1 CI warning.
    const tree = Array.from({ length: 120 }, (_, i) => ({ path: `db/m_${i}.sql`, type: 'blob' }));
    const files = Object.fromEntries(
      tree.map((node, i) => [
        node.path,
        `CREATE TABLE t_${i} (id uuid PRIMARY KEY);\nselect auth.uid();`,
      ]),
    );
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
    const schema = `${Array.from(
      { length: 120 },
      (_, i) => `CREATE TABLE t_${i} (id uuid PRIMARY KEY);`,
    ).join('\n')}\nselect auth.uid();`;
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
    expect(await screen.findByText(/120 blockers · 121 findings/i)).toBeTruthy();

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

describe('Stop scan', () => {
  it('aborts an in-flight Instant Gate scan without persisting or reporting failure', async () => {
    const hanging = stubHangingGitHubFetch();

    render(<DashboardClient initialSession={session} />);
    runScan();

    fireEvent.click(await screen.findByRole('button', { name: /stop scan/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /run secure scan/i }).textContent).toMatch(
        /run secure scan/i,
      );
    });
    expect(screen.queryByRole('button', { name: /stop scan/i })).toBeNull();
    expect(saveScanMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert', { name: /scan failed/i })).toBeNull();
    expect(screen.getByText(/scan stopped/i).closest('[role="status"]')).toBeTruthy();

    hanging.release();
    await Promise.resolve();
    expect(saveScanMock).not.toHaveBeenCalled();
  });

  it('keeps the previous Ship Gate verdict when a later scan is stopped', async () => {
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
          suggestion: 'Enable RLS.',
          created_at: savedScan.created_at,
        },
      ],
    });

    render(<DashboardClient initialSession={session} />);
    runScan();

    await waitFor(() => expect(saveScanMock).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByTestId('scan-findings-details-toggle'));
    await expectRlsFindingInDetails();

    stubHangingGitHubFetch();
    runScan();
    fireEvent.click(await screen.findByRole('button', { name: /stop scan/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /run secure scan/i }).textContent).toMatch(
        /run secure scan/i,
      );
    });
    expect(saveScanMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert', { name: /scan failed/i })).toBeNull();
    assertRlsFindingInDetails();
    expect(screen.getByText(/scan stopped/i).closest('[role="status"]')).toBeTruthy();
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
        jsonError(404, 'This repository is not accessible to the Assurly GitHub App installation.'),
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
        jsonError(404, 'This repository is not accessible to the Assurly GitHub App installation.'),
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

  it('does not persist a fake scan when Instant Gate rejects a too-large repository', async () => {
    const fetchMock = stubRoutedFetch({
      proxyTree: () =>
        jsonError(
          413,
          'This repository is too large for the in-browser scan. Run Full Gate locally.',
        ),
      publicTree: () =>
        jsonError(
          413,
          'This repository is too large for the in-browser scan. Run Full Gate locally.',
        ),
    });

    render(<DashboardClient initialSession={installedSession} />);
    runScan();

    const panel = await screen.findByTestId('scan-error-panel');
    expect(panel.textContent).toMatch(/Too large for Instant Gate/i);
    expect(screen.getByTestId('scan-error-full-gate')).toBeTruthy();
    expect(screen.queryByText(/No scannable application files/i)).toBeNull();
    expect(screen.queryByText(/commit unknown/i)).toBeNull();
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
            'This repository is not accessible to the Assurly GitHub App installation.',
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
