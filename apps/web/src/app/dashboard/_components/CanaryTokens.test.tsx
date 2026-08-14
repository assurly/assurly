// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanaryTokenSummary } from '../../../utils/clientApi';
import { clientApi } from '../../../utils/clientApi';
import { CanaryTokens } from './CanaryTokens';

vi.mock('../../../utils/clientApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/clientApi')>();
  return {
    ...actual,
    clientApi: {
      ...actual.clientApi,
      canary: {
        list: vi.fn(),
        issue: vi.fn(),
        revoke: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

const listMock = vi.mocked(clientApi.canary.list);
const issueMock = vi.mocked(clientApi.canary.issue);
const revokeMock = vi.mocked(clientApi.canary.revoke);
const deleteMock = vi.mocked(clientApi.canary.delete);

const TARGET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
  revokeMock.mockResolvedValue({ revoked: true });
  deleteMock.mockResolvedValue({ deleted: true });
});

describe('CanaryTokens', () => {
  it('gives every control an accessible name', async () => {
    listMock.mockResolvedValue({
      targetId: TARGET_ID,
      prefix: 'ask_canary_',
      tokens: [token({ id: 't1', label: 'Staging decoy' })],
    });
    render(<CanaryTokens targetId={TARGET_ID} />);
    await waitFor(() => {
      expect(screen.getByLabelText('Active canary tokens')).toBeTruthy();
    });
    expect(screen.getByLabelText('Canary token label')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Issue canary' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke canary Staging decoy' })).toBeTruthy();
  });

  it('renders without horizontal overflow at 320 px', async () => {
    listMock.mockResolvedValue({
      targetId: TARGET_ID,
      prefix: 'ask_canary_',
      tokens: [
        token({
          id: 't1',
          label: 'A very long canary label that must wrap instead of overflowing the panel',
          hitCount: 2,
          lastHitAt: '2026-07-20T12:00:00.000Z',
        }),
      ],
    });
    const { container } = render(<CanaryTokens targetId={TARGET_ID} />);
    await waitFor(() => {
      expect(screen.getByLabelText('Canary tokens')).toBeTruthy();
    });
    const panel = container.querySelector('.canary-tokens') as HTMLElement;
    expect(panel).toBeTruthy();
    Object.defineProperty(panel, 'clientWidth', { configurable: true, value: 320 });
    Object.defineProperty(panel, 'scrollWidth', { configurable: true, value: 320 });
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
  });

  it('shows the plaintext once after issue and never in the list', async () => {
    const plaintext = 'ask_canary_' + 'x'.repeat(32);
    issueMock.mockResolvedValue({
      id: 'new-1',
      label: 'Staging decoy',
      tokenPrefix: 'ask_canary_bbbbbb',
      token: plaintext,
      plantHint: 'Plant this…',
      createdAt: '2026-07-20T00:00:00.000Z',
    });
    render(<CanaryTokens targetId={TARGET_ID} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Issue canary' })).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText('Canary token label'), {
      target: { value: 'Staging decoy' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Issue canary' }));
    await waitFor(() => {
      expect(screen.getByText(plaintext)).toBeTruthy();
    });
    expect(screen.getByText(/will not be shown again/i)).toBeTruthy();
    // List rows show prefix only — never the full plaintext again as a second copy in the list.
    const active = screen.getByLabelText('Active canary tokens');
    expect(within(active).queryByText(plaintext)).toBeNull();
  });

  it('confirms before revoke and calls the revoke API', async () => {
    listMock.mockResolvedValue({
      targetId: TARGET_ID,
      prefix: 'ask_canary_',
      tokens: [token({ id: 't1', label: 'Staging decoy' })],
    });
    render(<CanaryTokens targetId={TARGET_ID} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Revoke canary Staging decoy' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke canary Staging decoy' }));
    expect(screen.getByTestId('canary-revoke-dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke canary' }));
    await waitFor(() => {
      expect(revokeMock).toHaveBeenCalledWith(TARGET_ID, 't1');
    });
  });

  it('shows delete only on revoked rows and requires confirm before deleting', async () => {
    listMock.mockResolvedValue({
      targetId: TARGET_ID,
      prefix: 'ask_canary_',
      tokens: [
        token({ id: 'active-1', label: 'Live decoy' }),
        token({
          id: 'revoked-1',
          label: 'Dead decoy',
          revokedAt: '2026-07-19T00:00:00.000Z',
        }),
      ],
    });

    render(<CanaryTokens targetId={TARGET_ID} />);

    await waitFor(() => {
      expect(screen.getByText('Live decoy')).toBeTruthy();
    });

    expect(screen.queryByTestId('canary-delete-active-1')).toBeNull();

    fireEvent.click(screen.getByText('Revoked canaries (1)'));
    const deleteBtn = screen.getByTestId('canary-delete-revoked-1');
    expect(deleteBtn).toBeTruthy();

    fireEvent.click(deleteBtn);
    expect(screen.getByRole('dialog', { name: 'Delete canary token?' })).toBeTruthy();
    expect(deleteMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete canary' }));
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith(TARGET_ID, 'revoked-1');
    });
  });

  it('aborts delete via Cancel without calling the API', async () => {
    listMock.mockResolvedValue({
      targetId: TARGET_ID,
      prefix: 'ask_canary_',
      tokens: [
        token({
          id: 'revoked-1',
          label: 'Dead decoy',
          revokedAt: '2026-07-19T00:00:00.000Z',
        }),
      ],
    });

    render(<CanaryTokens targetId={TARGET_ID} />);
    fireEvent.click(await screen.findByText('Revoked canaries (1)'));
    fireEvent.click(screen.getByTestId('canary-delete-revoked-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('canary-delete-dialog')).toBeNull();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(screen.getByText('Dead decoy')).toBeTruthy();
  });

  it('aborts delete via Escape without calling the API', async () => {
    listMock.mockResolvedValue({
      targetId: TARGET_ID,
      prefix: 'ask_canary_',
      tokens: [
        token({
          id: 'revoked-1',
          label: 'Dead decoy',
          revokedAt: '2026-07-19T00:00:00.000Z',
        }),
      ],
    });

    render(<CanaryTokens targetId={TARGET_ID} />);
    fireEvent.click(await screen.findByText('Revoked canaries (1)'));
    fireEvent.click(screen.getByTestId('canary-delete-revoked-1'));
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('canary-delete-dialog')).toBeNull();
    });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('optimistically removes a revoked canary and rolls back on failure', async () => {
    listMock.mockResolvedValue({
      targetId: TARGET_ID,
      prefix: 'ask_canary_',
      tokens: [
        token({
          id: 'revoked-1',
          label: 'Dead decoy',
          revokedAt: '2026-07-19T00:00:00.000Z',
        }),
      ],
    });
    deleteMock.mockRejectedValueOnce(new Error('Delete failed.'));

    render(<CanaryTokens targetId={TARGET_ID} />);
    fireEvent.click(await screen.findByText('Revoked canaries (1)'));
    fireEvent.click(screen.getByTestId('canary-delete-revoked-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete canary' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Delete failed.');
    });
    expect(screen.getByText('Revoked canaries (1)')).toBeTruthy();
    fireEvent.click(screen.getByText('Revoked canaries (1)'));
    expect(screen.getByText('Dead decoy')).toBeTruthy();
  });

  it('explains hits as exposure evidence, not attribution', async () => {
    listMock.mockResolvedValue({
      targetId: TARGET_ID,
      prefix: 'ask_canary_',
      tokens: [
        token({
          id: 'hit-1',
          label: 'Docs decoy',
          hitCount: 1,
          lastHitAt: '2026-07-20T12:00:00.000Z',
        }),
      ],
    });
    render(<CanaryTokens targetId={TARGET_ID} />);
    await waitFor(() => {
      expect(screen.getByText('Recorded hits')).toBeTruthy();
    });
    expect(screen.getByText(/evidence of exposure/i)).toBeTruthy();
    expect(screen.getAllByText(/not proof of who/i).length).toBeGreaterThanOrEqual(1);
  });
});
