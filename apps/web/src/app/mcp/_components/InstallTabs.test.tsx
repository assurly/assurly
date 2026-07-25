// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstallTabs } from './InstallTabs';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('InstallTabs', () => {
  it('exposes a keyboard-operable tablist with the five install clients', () => {
    render(<InstallTabs />);

    expect(screen.getByRole('tablist', { name: /mcp client install/i })).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Cursor',
      'Claude Code',
      'VS Code',
      'Windsurf',
      'Other',
    ]);

    const cursor = screen.getByRole('tab', { name: 'Cursor' });
    expect(cursor.getAttribute('aria-selected')).toBe('true');
    expect(cursor.getAttribute('tabindex')).toBe('0');
    expect(cursor.getAttribute('aria-controls')).toBe('mcp-install-panel-cursor');
    expect(screen.getByRole('tabpanel')).toBeTruthy();
    expect(screen.getByText(/\.cursor\/mcp\.json/)).toBeTruthy();

    // Every tab keeps a resolvable aria-controls target: inactive panels stay in
    // the DOM with `hidden` instead of being unmounted.
    for (const tab of tabs) {
      const panelId = tab.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      expect(document.getElementById(panelId!)).toBeTruthy();
    }
  });

  it('switches panels on click and moves focus with arrow keys', () => {
    render(<InstallTabs />);

    fireEvent.click(screen.getByRole('tab', { name: 'VS Code' }));
    expect(screen.getByRole('tab', { name: 'VS Code' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText(/\.vscode\/mcp\.json/)).toBeTruthy();
    expect(screen.getByText(/top-level key/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'VS Code MCP configuration' }).textContent).toContain(
      '"servers"',
    );

    const vscode = screen.getByRole('tab', { name: 'VS Code' });
    fireEvent.keyDown(vscode, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Windsurf' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByText(/\.codeium\/windsurf\/mcp_config\.json/)).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Windsurf' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Cursor' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows the Claude Code CLI install command', () => {
    render(<InstallTabs />);
    fireEvent.click(screen.getByRole('tab', { name: 'Claude Code' }));
    expect(screen.getByText('claude mcp add assurly -- npx -y @assurly/mcp-server')).toBeTruthy();
  });
});
