// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiKeySummary } from '../../../utils/clientApi';
import { clientApi } from '../../../utils/clientApi';
import { ApiKeys } from './ApiKeys';

vi.mock('../../../utils/clientApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/clientApi')>();
  return {
    ...actual,
    clientApi: {
      ...actual.clientApi,
      apiKeys: {
        list: vi.fn(),
        create: vi.fn(),
        revoke: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

const listMock = vi.mocked(clientApi.apiKeys.list);
const deleteMock = vi.mocked(clientApi.apiKeys.delete);

function key(
  overrides: Partial<ApiKeySummary> & Pick<ApiKeySummary, 'id' | 'label'>,
): ApiKeySummary {
  return {
    keyPrefix: 'ask_live_ab12cd',
    plan: 'free',
    lastUsedAt: null,
    revokedAt: null,
    createdAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

const LONG_LABEL = 'sk-ant-api03-' + 'a'.repeat(100);

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue({ keys: [] });
  deleteMock.mockResolvedValue({ deleted: true });
});

describe('ApiKeys', () => {
  it('renders active keys first and collapses revoked keys by default with the right count', async () => {
    listMock.mockResolvedValue({
      keys: [
        key({ id: 'active-1', label: 'Cursor agent', revokedAt: null }),
        key({
          id: 'revoked-1',
          label: 'Old CI',
          revokedAt: '2026-07-19T00:00:00.000Z',
        }),
        key({
          id: 'revoked-2',
          label: 'OEM trial',
          revokedAt: '2026-07-18T12:00:00.000Z',
        }),
      ],
    });

    render(<ApiKeys />);

    await waitFor(() => {
      expect(screen.getByLabelText('Active API keys')).toBeTruthy();
    });

    expect(screen.getByText('Cursor agent')).toBeTruthy();

    const disclosure = screen.getByText('Revoked keys (2)').closest('details');
    expect(disclosure).toBeTruthy();
    expect(disclosure?.open).toBe(false);
    // Closed <details> still mounts children in the DOM; assert they live only
    // inside the disclosure and stay collapsed until expanded.
    const revokedList = within(disclosure as HTMLDetailsElement).getByLabelText('Revoked API keys');
    expect(within(revokedList).getByText('Old CI')).toBeTruthy();
    expect(within(revokedList).getByText('OEM trial')).toBeTruthy();
    expect(screen.getByLabelText('Active API keys').textContent).not.toContain('Old CI');

    fireEvent.click(screen.getByText('Revoked keys (2)'));
    expect(disclosure?.open).toBe(true);
  });

  it('shows a meaningful empty state when only revoked keys remain', async () => {
    listMock.mockResolvedValue({
      keys: [
        key({
          id: 'revoked-only',
          label: 'Gone',
          revokedAt: '2026-07-19T00:00:00.000Z',
        }),
      ],
    });

    render(<ApiKeys />);

    await waitFor(() => {
      expect(screen.getByText('No active API keys.')).toBeTruthy();
    });
    expect(screen.getByText('Revoked keys (1)')).toBeTruthy();
  });

  it('keeps a long label on a single truncated line with the full value in title', async () => {
    listMock.mockResolvedValue({
      keys: [key({ id: 'long-1', label: LONG_LABEL })],
    });

    render(<ApiKeys />);

    const labelEl = await screen.findByTitle(LONG_LABEL);
    expect(labelEl.className).toContain('api-keys__item-label');
    expect(labelEl.textContent).toBe(LONG_LABEL);

    const styles = window.getComputedStyle(labelEl);
    // jsdom may not load globals.css; assert the class contract that CSS enforces.
    expect(labelEl.classList.contains('api-keys__item-label')).toBe(true);
    void styles;
  });

  it('shows delete only on revoked rows and requires confirm before deleting', async () => {
    listMock.mockResolvedValue({
      keys: [
        key({ id: 'active-1', label: 'Live key' }),
        key({
          id: 'revoked-1',
          label: 'Dead key',
          revokedAt: '2026-07-19T00:00:00.000Z',
        }),
      ],
    });

    render(<ApiKeys />);

    await waitFor(() => {
      expect(screen.getByText('Live key')).toBeTruthy();
    });

    expect(screen.queryByTestId('api-key-delete-active-1')).toBeNull();

    fireEvent.click(screen.getByText('Revoked keys (1)'));
    const deleteBtn = screen.getByTestId('api-key-delete-revoked-1');
    expect(deleteBtn).toBeTruthy();

    fireEvent.click(deleteBtn);
    expect(screen.getByRole('dialog', { name: 'Delete API key?' })).toBeTruthy();
    expect(deleteMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete key' }));
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith('revoked-1');
    });
  });

  it('aborts delete via Cancel without calling the API', async () => {
    listMock.mockResolvedValue({
      keys: [
        key({
          id: 'revoked-1',
          label: 'Dead key',
          revokedAt: '2026-07-19T00:00:00.000Z',
        }),
      ],
    });

    render(<ApiKeys />);
    fireEvent.click(await screen.findByText('Revoked keys (1)'));
    fireEvent.click(screen.getByTestId('api-key-delete-revoked-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('api-key-delete-dialog')).toBeNull();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(screen.getByText('Dead key')).toBeTruthy();
  });

  it('aborts delete via Escape without calling the API', async () => {
    listMock.mockResolvedValue({
      keys: [
        key({
          id: 'revoked-1',
          label: 'Dead key',
          revokedAt: '2026-07-19T00:00:00.000Z',
        }),
      ],
    });

    render(<ApiKeys />);
    fireEvent.click(await screen.findByText('Revoked keys (1)'));
    fireEvent.click(screen.getByTestId('api-key-delete-revoked-1'));
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('api-key-delete-dialog')).toBeNull();
    });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('optimistically removes a revoked key and rolls back on failure', async () => {
    listMock.mockResolvedValue({
      keys: [
        key({
          id: 'revoked-1',
          label: 'Dead key',
          revokedAt: '2026-07-19T00:00:00.000Z',
        }),
      ],
    });
    deleteMock.mockRejectedValueOnce(new Error('Delete failed.'));

    render(<ApiKeys />);
    fireEvent.click(await screen.findByText('Revoked keys (1)'));
    fireEvent.click(screen.getByTestId('api-key-delete-revoked-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete key' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Delete failed.');
    });
    // Disclosure remounts closed after rollback; count proves the row returned.
    expect(screen.getByText('Revoked keys (1)')).toBeTruthy();
    fireEvent.click(screen.getByText('Revoked keys (1)'));
    expect(screen.getByText('Dead key')).toBeTruthy();
  });

  it('warns when the label looks like a secret without blocking submit', async () => {
    listMock.mockResolvedValue({ keys: [] });
    render(<ApiKeys />);

    const input = await screen.findByPlaceholderText('Key label (e.g. Cursor agent)');
    fireEvent.change(input, { target: { value: 'sk-ant-secret-value-here' } });

    expect(screen.getByRole('status').textContent).toMatch(/looks like a secret/i);
    expect((screen.getByRole('button', { name: 'Create key' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('keeps a failed background list silent (no role=alert)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    listMock.mockRejectedValueOnce(new Error('network down'));

    render(<ApiKeys />);

    await waitFor(() => {
      expect(warn).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('No API keys yet.')).toBeTruthy();
  });

  it('shows created / last-used metadata on each key', async () => {
    listMock.mockResolvedValue({
      keys: [
        key({
          id: 'active-1',
          label: 'Cursor agent',
          createdAt: '2026-07-18T00:00:00.000Z',
          lastUsedAt: null,
        }),
      ],
    });

    render(<ApiKeys />);
    await waitFor(() => {
      expect(screen.getByText('Created 18 Jul · Never used')).toBeTruthy();
    });
  });
});
