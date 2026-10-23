// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findingCode: vi.fn() }));
vi.mock('../../../utils/clientApi', () => ({ clientApi: { findingCode: mocks.findingCode } }));

import { FindingCodePreview } from './FindingCodePreview';

const COMMIT = 'b74c7bc0a5f1e2d3c4b5a6978877665544332211';

const loaded = {
  available: true as const,
  file: 'app/api/webhooks/stripe/route.ts',
  commitSha: COMMIT,
  githubUrl: `https://github.com/tibco87/notes/blob/${COMMIT}/app/api/webhooks/stripe/route.ts#L6`,
  window: {
    startLine: 4,
    lines: [
      '',
      '// Stripe calls this on every subscription change.',
      'export async function POST(request: Request) {',
      '  const event = JSON.parse(await request.text())',
    ],
    highlightLine: 6,
    redactedCount: 1,
  },
  suggestedChange: null,
};

function open(): void {
  const details = screen.getByTestId('finding-code-finding-1') as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event('toggle'));
}

beforeEach(() => {
  mocks.findingCode.mockReset();
});
afterEach(() => {
  cleanup();
});

describe('FindingCodePreview', () => {
  it('fetches nothing until the reader opens it', () => {
    render(<FindingCodePreview findingId="finding-1" />);
    expect(screen.getByText('Show the code')).toBeTruthy();
    expect(mocks.findingCode).not.toHaveBeenCalled();
  });

  it('shows the lines at the scanned commit with the finding line marked', async () => {
    mocks.findingCode.mockResolvedValue(loaded);
    render(<FindingCodePreview findingId="finding-1" />);
    await act(async () => open());

    expect(mocks.findingCode).toHaveBeenCalledTimes(1);
    expect(mocks.findingCode.mock.calls[0][0]).toBe('finding-1');
    const marked = screen.getByTestId('finding-code-line-6');
    expect(marked.getAttribute('aria-current')).toBe('true');
    expect(marked.textContent).toContain('export async function POST');
    expect(screen.getByText('b74c7bc')).toBeTruthy();
    expect(screen.getByText(/1 credential hidden/i)).toBeTruthy();
    const link = screen.getByRole('link', { name: /open on github/i });
    expect(link.getAttribute('href')).toBe(loaded.githubUrl);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('fetches once, however often it is reopened', async () => {
    mocks.findingCode.mockResolvedValue(loaded);
    render(<FindingCodePreview findingId="finding-1" />);
    await act(async () => open());
    await act(async () => open());
    expect(mocks.findingCode).toHaveBeenCalledTimes(1);
  });

  it('shows the change the fix would make as a diff', async () => {
    mocks.findingCode.mockResolvedValue({
      ...loaded,
      suggestedChange: {
        title: 'Enable RLS',
        description: 'Adds a migration.',
        file: 'supabase/migrations/99999999999999_assurly_enable_rls.sql',
        isNewFile: true,
        lines: [
          { kind: 'add', text: 'ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;', newLine: 1 },
        ],
      },
    });
    render(<FindingCodePreview findingId="finding-1" />);
    await act(async () => open());

    expect(screen.getByText('What the fix changes')).toBeTruthy();
    expect(screen.getByText(/new file/i)).toBeTruthy();
    const added = screen.getByText('ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;');
    expect(added.closest('[data-kind]')?.getAttribute('data-kind')).toBe('add');
  });

  it('explains why the code cannot be shown', async () => {
    mocks.findingCode.mockResolvedValue({
      available: false,
      reason: 'sensitive_file',
      message: 'Assurly never displays env files or key material.',
      githubUrl: null,
    });
    render(<FindingCodePreview findingId="finding-1" />);
    await act(async () => open());
    expect(screen.getByText('Assurly never displays env files or key material.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('offers a retry when the request fails', async () => {
    mocks.findingCode.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(loaded);
    render(<FindingCodePreview findingId="finding-1" />);
    await act(async () => open());

    expect(screen.getByRole('alert').textContent).toMatch(/could not load/i);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /try again/i })));
    expect(mocks.findingCode).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('finding-code-line-6')).toBeTruthy();
  });

  it('cancels the request when the card goes away', async () => {
    let signal: AbortSignal | undefined;
    mocks.findingCode.mockImplementation((_id: string, s: AbortSignal) => {
      signal = s;
      return new Promise(() => {});
    });
    const { unmount } = render(<FindingCodePreview findingId="finding-1" />);
    await act(async () => open());
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
