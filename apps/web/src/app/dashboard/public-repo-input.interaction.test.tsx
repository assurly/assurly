// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DashboardClient from './_components/DashboardClient';
import * as clientApiModule from '../../utils/clientApi';

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
      scans: vi.fn().mockResolvedValue({ scans: [] }),
      findings: vi.fn().mockResolvedValue({ findings: [] }),
    },
    githubApi: {
      ...actual.githubApi,
      repositories: vi.fn(),
      repository: vi.fn(),
    },
  };
});

const attestaRepo = {
  id: '11000000-0000-4000-8000-000000000010',
  organization_id: 'org-1',
  name: 'tibco87/Attesta',
  github_repo_id: 101,
  is_active: true,
  created_at: '2026-06-21T00:00:00Z',
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
  repositories: [attestaRepo],
};

beforeEach(() => {
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
  vi.mocked(clientApiModule.githubApi.repositories).mockReset();
  vi.mocked(clientApiModule.githubApi.repository).mockReset();
});

afterEach(() => {
  cleanup();
});

describe('Public repository input reset', () => {
  it('clears draft public repo text when switching to Manual Checker', () => {
    render(<DashboardClient initialSession={session} />);

    const input = screen.getByLabelText(/public github repository/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'vercel/next.js' } });
    expect(input.value).toBe('vercel/next.js');

    fireEvent.click(screen.getByRole('button', { name: /manual checker/i }));
    fireEvent.click(screen.getByRole('button', { name: /^apps$/i }));

    const restoredInput = screen.getByLabelText(/public github repository/i) as HTMLInputElement;
    expect(restoredInput.value).toBe('');
  });
});

describe('Public repository Connect & Scan validation', () => {
  it('does not look up GitHub users for not-a-repo', () => {
    render(<DashboardClient initialSession={session} />);

    const input = screen.getByLabelText(/public github repository/i);
    fireEvent.change(input, { target: { value: 'not-a-repo' } });

    const submit = screen.getByRole('button', { name: /connect & scan/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    fireEvent.submit(input.closest('form')!);

    expect(clientApiModule.githubApi.repositories).not.toHaveBeenCalled();
    expect(clientApiModule.githubApi.repository).not.toHaveBeenCalled();
  });

  it('shows an inline card error when a well-formed repo is not found', async () => {
    vi.mocked(clientApiModule.githubApi.repository).mockRejectedValue(
      new clientApiModule.ClientApiError(
        'Repository not found. Use the owner/repo format for a public repository.',
        404,
        'repo_not_found',
      ),
    );

    render(<DashboardClient initialSession={session} />);

    fireEvent.change(screen.getByLabelText(/public github repository/i), {
      target: { value: 'acme/no-such-repo-xyz' },
    });
    fireEvent.click(screen.getByRole('button', { name: /connect & scan/i }));

    await waitFor(() => {
      const card = screen.getByRole('region', { name: /scan public repository/i });
      expect(within(card).getByRole('alert').textContent).toContain('Repository not found');
    });
    expect(
      (screen.getByRole('button', { name: /connect & scan/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(clientApiModule.githubApi.repositories).not.toHaveBeenCalled();
  });
});

describe('Dashboard tab keep-alive prefs', () => {
  it('keeps Compact and Blocked across Manual Checker', async () => {
    vi.mocked(clientApiModule.clientApi.targets).mockResolvedValue({
      targets: [
        {
          id: 't-blocked',
          kind: 'repo',
          identifier: 'acme/blocked',
          displayName: 'acme/blocked',
          repositoryId: attestaRepo.id,
          generatorFingerprint: null,
          verdict: 'blocked',
          shipScore: 40,
          topIssue: {
            key: 'rule:secret',
            label: 'Secret in source',
            severity: 'error',
            sampleMessage: 'Secret',
            affectedFileCount: 1,
            occurrenceCount: 1,
          },
          lastCheckedAt: '2026-08-01T00:00:00Z',
          latestScanId: 'scan-1',
          ownershipVerified: true,
          guardianEnabled: false,
          scoreDropped: false,
          badgeToken: null,
          scanCapability: 'browser',
          lastScanFailed: false,
          lastScanFailureReason: null,
        },
        {
          id: 't-ready',
          kind: 'repo',
          identifier: 'acme/ready',
          displayName: 'acme/ready',
          repositoryId: '11000000-0000-4000-8000-000000000011',
          generatorFingerprint: null,
          verdict: 'ready',
          shipScore: 96,
          topIssue: null,
          lastCheckedAt: '2026-08-01T00:00:00Z',
          latestScanId: 'scan-2',
          ownershipVerified: true,
          guardianEnabled: false,
          scoreDropped: false,
          badgeToken: null,
          scanCapability: 'browser',
          lastScanFailed: false,
          lastScanFailureReason: null,
        },
      ],
    });

    render(<DashboardClient initialSession={session} />);

    await waitFor(() => {
      expect(screen.getByTestId('apps-density-compact')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('apps-density-compact'));
    fireEvent.click(screen.getByRole('button', { name: /Blocked \(1\)/i }));
    expect(screen.getByTestId('apps-density-compact').getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole('button', { name: /Blocked \(1\)/i }).getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /manual checker/i }));
    fireEvent.click(screen.getByRole('button', { name: /^apps$/i }));

    expect(screen.getByTestId('apps-density-compact').getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole('button', { name: /Blocked \(1\)/i }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
