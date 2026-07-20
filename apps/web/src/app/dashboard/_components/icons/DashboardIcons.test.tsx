// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DashboardBuildingIcon,
  DashboardFolderIcon,
  DashboardSearchIcon,
  DashboardZapIcon,
} from './DashboardIcons';
import { AssurlyLogo } from './AssurlyLogo';

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

  it('renders the Assurly logo mark without emoji copy', () => {
    const { container } = render(<AssurlyLogo />);

    // Wordmark "Ass·url·y": the accented middle spells the URL the product scans,
    // and the whole still reads as the single word "Assurly".
    expect(container.querySelector('.assurly-logo__text')?.textContent).toBe('Assurly');
    expect(container.querySelector('.assurly-logo__accent')?.textContent).toBe('url');
    expect(container.querySelector('.assurly-logo__mark')).toBeTruthy();
    expect(container.textContent).not.toMatch(/📦/);
  });
});
