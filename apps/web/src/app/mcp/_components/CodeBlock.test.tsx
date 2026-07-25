// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeBlock } from './CodeBlock';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CodeBlock', () => {
  it('renders a scrollable, keyboard-reachable region with the exact code', () => {
    render(<CodeBlock code={'npx -y @assurly/mcp-server'} label="Install command" />);

    const region = screen.getByRole('region', { name: 'Install command' });
    expect(region.className).toContain('code-block');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.textContent).toBe('npx -y @assurly/mcp-server');
  });

  it('copies the exact content and shows a transient Copied state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CodeBlock code={'hello\nworld'} label="Sample snippet" />);

    const button = screen.getByRole('button', { name: /copy sample snippet/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('hello\nworld');
      expect(screen.getByRole('button', { name: /^copied$/i })).toBeTruthy();
      expect(screen.getByText('Copied to clipboard')).toBeTruthy();
    });
  });

  it('falls back when navigator.clipboard is unavailable', async () => {
    Object.assign(navigator, { clipboard: undefined });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    render(<CodeBlock code="fallback-text" label="Fallback snippet" />);

    fireEvent.click(screen.getByRole('button', { name: /copy fallback snippet/i }));

    await waitFor(() => {
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(screen.getByRole('button', { name: /^copied$/i })).toBeTruthy();
    });
  });

  it('surfaces a Press ⌘C failure state when copy fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, { clipboard: { writeText } });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });

    render(<CodeBlock code="secret" label="Secret snippet" />);

    fireEvent.click(screen.getByRole('button', { name: /copy secret snippet/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /press ⌘c to copy secret snippet/i })).toBeTruthy();
      expect(screen.getByText(/copy failed/i)).toBeTruthy();
    });
    expect(screen.queryByText('Copied to clipboard')).toBeNull();
  });
});
