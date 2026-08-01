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

  it('exposes a clean accessible name instead of "Ass url y"', () => {
    render(<AssurlyLogo />);
    expect(screen.getByRole('img', { name: 'Assurly' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /Ass url y/i })).toBeNull();
  });

  it('stays presentational when decorative so a parent link can own the name', () => {
    const { container } = render(<AssurlyLogo decorative />);
    const root = container.querySelector('.assurly-logo');
    expect(root?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
