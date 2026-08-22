// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanaryTokenSummary } from '../../../utils/clientApi';
import { ClientApiError, clientApi } from '../../../utils/clientApi';
import { ASSURLY_CANARY_ENV_KEY } from '@assurly/scanner-core';
import { CANARY_HIT_ROTATE_COPY, CANARY_SILENT_ALARM_LABEL } from '../../../utils/canaryPlant';
import { CanarySilentAlarm } from './CanarySilentAlarm';

vi.mock('../../../utils/clientApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/clientApi')>();
  return {
    ...actual,
    clientApi: {
      ...actual.clientApi,
      canary: {
        list: vi.fn(),
        issue: vi.fn(),
        plant: vi.fn(),
        revoke: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

const listMock = vi.mocked(clientApi.canary.list);
const issueMock = vi.mocked(clientApi.canary.issue);
const plantMock = vi.mocked(clientApi.canary.plant);

const TARGET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAINTEXT = 'ask_canary_' + 'x'.repeat(32);
const CALLBACK = `https://assurly.dev/api/canary/${PLAINTEXT}`;
const SNIPPET = [
  '# Assurly silent alarm — tripwire only. Do not copy into production .env as a real service URL.',
  '# If this URL is fetched, Assurly alerts you. Rotate real Stripe, Supabase, and GitHub secrets — not this value.',
  `${ASSURLY_CANARY_ENV_KEY}=${CALLBACK}`,
].join('\n');

function token(
  overrides: Partial<CanaryTokenSummary> & Pick<CanaryTokenSummary, 'id' | 'label'>,
): CanaryTokenSummary {
  return {
    tokenPrefix: 'ask_canary_bbbbbb',
    hitCount: 0,
    lastHitAt: null,
    revokedAt: null,
    createdAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue({
    targetId: TARGET_ID,
    prefix: 'ask_canary_',
    tokens: [],
  });
});

describe('CanarySilentAlarm', () => {
  it('issues a tripwire and copies the .env.example snippet', async () => {
    issueMock.mockResolvedValue({
      id: 'new-1',
      label: CANARY_SILENT_ALARM_LABEL,
      tokenPrefix: 'ask_canary_bbbbbb',
      token: PLAINTEXT,
      callbackUrl: CALLBACK,
      snippet: SNIPPET,
      plantHint: 'Paste these three lines',
      createdAt: '2026-07-20T00:00:00.000Z',
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<CanarySilentAlarm targetId={TARGET_ID} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add a silent alarm' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add a silent alarm' }));

    await waitFor(() => {
      expect(issueMock).toHaveBeenCalledWith(TARGET_ID, CANARY_SILENT_ALARM_LABEL);
    });
    expect(screen.getByText(new RegExp(`${ASSURLY_CANARY_ENV_KEY}=`))).toBeTruthy();
    expect(screen.getByText(/Armed · Never used/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy silent alarm snippet' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(SNIPPET);
    });
  });

  it('when already armed without a snippet, offers a new plant snippet', async () => {
    listMock.mockResolvedValue({
      targetId: TARGET_ID,
      prefix: 'ask_canary_',
      tokens: [token({ id: 't1', label: CANARY_SILENT_ALARM_LABEL })],
    });
    issueMock.mockResolvedValue({
      id: 'new-2',
      label: CANARY_SILENT_ALARM_LABEL,
      tokenPrefix: 'ask_canary_cccccc',
      token: PLAINTEXT,
      callbackUrl: CALLBACK,
      snippet: SNIPPET,
      plantHint: 'Paste these three lines',
      createdAt: '2026-07-20T00:00:00.000Z',
    });

    render(<CanarySilentAlarm targetId={TARGET_ID} />);
    await waitFor(() => {
      expect(screen.getByText(/Armed · Never used/i)).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Add a silent alarm' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show plant snippet' }));
    await waitFor(() => {
      expect(issueMock).toHaveBeenCalledWith(TARGET_ID, CANARY_SILENT_ALARM_LABEL);
    });
    expect(screen.getByRole('button', { name: 'Copy silent alarm snippet' })).toBeTruthy();
  });

  it('shows rotate-real-secrets copy after a hit', async () => {
    listMock.mockResolvedValue({
      targetId: TARGET_ID,
      prefix: 'ask_canary_',
      tokens: [
        token({
          id: 'hit-1',
          label: CANARY_SILENT_ALARM_LABEL,
          hitCount: 1,
          lastHitAt: '2026-07-20T12:00:00.000Z',
        }),
      ],
    });
    render(<CanarySilentAlarm targetId={TARGET_ID} />);
    await waitFor(() => {
      expect(screen.getByText('Tripwire fetched')).toBeTruthy();
    });
    expect(screen.getByText(CANARY_HIT_ROTATE_COPY)).toBeTruthy();
    expect(screen.queryByText(/Armed · Never used/i)).toBeNull();
  });

  it('opens a plant PR when the GitHub App is connected', async () => {
    plantMock.mockResolvedValue({
      id: 'new-plant',
      snippet: SNIPPET,
      mcpSnippet: `// decoy\n{"mcpServers":{"assurly-cloud-auth":{"url":"${CALLBACK}"}}}`,
      prUrl: 'https://github.com/acme/app/pull/42',
      alreadyPlanted: false,
      tokenPrefix: 'ask_canary_bbbbbb',
      createdAt: '2026-08-18T00:00:00.000Z',
    });

    render(<CanarySilentAlarm targetId={TARGET_ID} hasGitHubInstallation />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open plant PR' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open plant PR' }));
    await waitFor(() => {
      expect(plantMock).toHaveBeenCalledWith(TARGET_ID);
    });
    const prLink = screen.getByRole('link', { name: 'Open plant pull request' });
    expect(prLink.getAttribute('href')).toBe('https://github.com/acme/app/pull/42');
    expect(prLink.className).toContain('scan-finding-action-btn--success');
    expect(screen.getByText(/assurly-cloud-auth/)).toBeTruthy();
  });

  it('does not present already-planted copy as a one-time tripwire snippet', async () => {
    plantMock.mockResolvedValue({
      alreadyPlanted: true,
      prUrl: null,
      snippet: `${ASSURLY_CANARY_ENV_KEY} is already in .env.example.`,
    });
    listMock.mockResolvedValue({
      targetId: TARGET_ID,
      prefix: 'ask_canary_',
      tokens: [token({ id: 't1', label: CANARY_SILENT_ALARM_LABEL })],
    });

    render(<CanarySilentAlarm targetId={TARGET_ID} hasGitHubInstallation />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open plant PR' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open plant PR' }));

    await waitFor(() => {
      expect(plantMock).toHaveBeenCalledWith(TARGET_ID);
    });
    expect(
      screen.getByText(
        `${ASSURLY_CANARY_ENV_KEY} is already in .env.example on the connected repository.`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/the tripwire URL will not be shown again/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy silent alarm snippet' })).toBeNull();
  });

  it('falls back to the copy snippet when the plant PR fails and keeps retry available', async () => {
    plantMock.mockRejectedValue(
      new ClientApiError('GitHub is temporarily unavailable.', 502, 'github_unavailable'),
    );
    issueMock.mockResolvedValue({
      id: 'fallback-1',
      label: CANARY_SILENT_ALARM_LABEL,
      tokenPrefix: 'ask_canary_bbbbbb',
      token: PLAINTEXT,
      callbackUrl: CALLBACK,
      snippet: SNIPPET,
      plantHint: 'Paste these three lines',
      createdAt: '2026-08-18T00:00:00.000Z',
    });

    render(<CanarySilentAlarm targetId={TARGET_ID} hasGitHubInstallation />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open plant PR' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open plant PR' }));

    await waitFor(() => {
      expect(plantMock).toHaveBeenCalledWith(TARGET_ID);
      expect(issueMock).toHaveBeenCalledWith(TARGET_ID, CANARY_SILENT_ALARM_LABEL);
    });
    expect(screen.getByRole('alert').textContent).toMatch(/retry Open plant PR/i);
    expect(screen.getByText(new RegExp(`${ASSURLY_CANARY_ENV_KEY}=`))).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open plant pull request' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open plant PR' })).toBeTruthy();
  });
});
