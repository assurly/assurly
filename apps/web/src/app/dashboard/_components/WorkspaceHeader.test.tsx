// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceHeader } from './WorkspaceHeader';

afterEach(() => cleanup());

describe('WorkspaceHeader', () => {
  it('renders the workspace name without a plan badge', () => {
    const { container } = render(<WorkspaceHeader orgName="acme" />);
    const desktop = container.querySelector('.dashboard-workspace--desktop');
    expect(desktop).toBeInstanceOf(HTMLElement);
    if (!(desktop instanceof HTMLElement)) throw new Error('expected desktop workspace');

    expect(within(desktop).getByText('Active Workspace')).toBeTruthy();
    expect(within(desktop).getByRole('heading', { name: 'acme' })).toBeTruthy();
    expect(within(desktop).queryByText('Pro Plan')).toBeNull();
    expect(within(desktop).queryByText('Free Plan')).toBeNull();
    expect(within(desktop).getByText(/Plan and billing are in your account menu/i)).toBeTruthy();
  });

  it('keeps the heading accessible name equal to the workspace name', () => {
    render(<WorkspaceHeader orgName="acme" />);
    const heading = screen.getByRole('heading', { name: 'acme' });
    expect(heading.textContent).toBe('acme');
  });

  it('replaces legacy placeholder org titles with the owner-derived name', () => {
    render(<WorkspaceHeader orgName="Developer's Workspace" ownerLabel="tiborkutiksson" />);
    expect(screen.getByRole('heading', { name: "tiborkutiksson's Workspace" })).toBeTruthy();
    expect(screen.queryByText("Developer's Workspace")).toBeNull();
  });

  it('renders a collapsed mobile workspace strip without a plan badge', () => {
    const { container } = render(<WorkspaceHeader orgName="acme" />);
    const strip = container.querySelector(
      '.dashboard-workspace--mobile [data-testid="workspace-mobile-strip"]',
    );
    expect(strip).toBeTruthy();
    if (!strip) throw new Error('expected mobile strip');

    expect(strip.textContent).toContain('acme');
    expect(strip.textContent).not.toMatch(/Pro Plan|Free Plan/);
    expect(strip.getAttribute('aria-label')).toBe('Workspace: acme');
  });

  it('falls back to My Workspace when no org name is provided', () => {
    render(<WorkspaceHeader />);
    expect(screen.getAllByText('My Workspace').length).toBeGreaterThan(0);
  });
});
