// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DashboardBuildingIcon,
  DashboardFolderIcon,
  DashboardSearchIcon,
  DashboardZapIcon,
} from './DashboardIcons';
import { ShipReadyLogo } from './ShipReadyLogo';

afterEach(() => {
  cleanup();
});

describe('dashboard icon system', () => {
  it('renders lucide icons as decorative SVGs', () => {
    const { container } = render(
      <div>
        <DashboardFolderIcon data-testid="folder-icon" />
        <DashboardZapIcon />
        <DashboardBuildingIcon />
        <DashboardSearchIcon />
      </div>,
    );

    const icons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(icons.length).toBe(4);
    expect(screen.getByTestId('folder-icon').getAttribute('class')).toContain('dashboard-icon');
  });

  it('renders the ShipReady logo mark without emoji copy', () => {
    const { container } = render(<ShipReadyLogo />);

    expect(screen.getByText('Ship')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(container.querySelector('.shipready-logo__mark')).toBeTruthy();
    expect(container.textContent).not.toMatch(/📦/);
  });
});
