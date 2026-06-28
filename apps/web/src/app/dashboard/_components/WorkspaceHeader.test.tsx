// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceHeader } from './WorkspaceHeader';

afterEach(() => {
  cleanup();
});

describe('WorkspaceHeader', () => {
  it('renders desktop workspace card without inline layout styles', () => {
    const { container } = render(<WorkspaceHeader orgName="acme" billingPlan="pro" />);

    const desktop = container.querySelector('.dashboard-workspace--desktop') as HTMLElement;
    expect(desktop).toBeTruthy();
    expect(within(desktop).getByText('Active Workspace')).toBeTruthy();
    expect(within(desktop).getByText('acme')).toBeTruthy();
    expect(within(desktop).getByText('Pro Plan')).toBeTruthy();
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('renders a collapsed mobile workspace strip with name and plan badge', () => {
    const { container } = render(<WorkspaceHeader orgName="acme" billingPlan="pro" />);

    const mobile = container.querySelector('.dashboard-workspace--mobile') as HTMLDetailsElement;
    expect(mobile).toBeTruthy();
    expect(mobile.open).toBe(false);

    const strip = screen.getByTestId('workspace-mobile-strip');
    expect(strip.textContent).toContain('acme');
    expect(strip.textContent).toContain('Pro Plan');
  });

  it('expands the mobile strip to reveal workspace context', () => {
    const { container } = render(<WorkspaceHeader orgName="acme" billingPlan="free" />);

    const mobile = container.querySelector('.dashboard-workspace--mobile') as HTMLDetailsElement;
    fireEvent.click(screen.getByTestId('workspace-mobile-strip'));

    expect(mobile.open).toBe(true);
    expect(
      screen.getByText('Plan and billing options are available in your account menu.'),
    ).toBeTruthy();
  });

  it('falls back to a default workspace name when org name is missing', () => {
    render(<WorkspaceHeader billingPlan="free" />);

    expect(screen.getAllByText('My Workspace').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Free Plan').length).toBeGreaterThan(0);
  });
});
