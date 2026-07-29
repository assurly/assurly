// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SiteFooter } from './SiteFooter';

afterEach(() => {
  cleanup();
});

describe('SiteFooter', () => {
  it('renders the full landing footer with product, legal, and resources columns', () => {
    render(<SiteFooter variant="full" />);

    expect(screen.getByRole('contentinfo', { name: 'Assurly site footer' })).toBeTruthy();
    expect(
      screen.getByText('Know what will break in production — before you deploy.'),
    ).toBeTruthy();
    expect(screen.getByText('© 2026 Assurly. All rights reserved.')).toBeTruthy();
    expect(screen.queryByText(/Licensed under MIT/i)).toBeNull();

    const productNav = screen.getByRole('navigation', { name: 'Product' });
    expect(within(productNav).getByRole('link', { name: 'Features' }).getAttribute('href')).toBe(
      '/#features',
    );
    expect(within(productNav).getByRole('link', { name: 'Pricing' }).getAttribute('href')).toBe(
      '/#pricing',
    );
    expect(within(productNav).getByRole('link', { name: 'MCP Server' }).getAttribute('href')).toBe(
      '/mcp',
    );
    expect(within(productNav).getByRole('link', { name: 'FAQ' }).getAttribute('href')).toBe(
      '/#faq',
    );
    expect(within(productNav).queryByRole('link', { name: 'Trust' })).toBeNull();

    const legalNav = screen.getByRole('navigation', { name: 'Legal' });
    expect(
      within(legalNav).getByRole('link', { name: 'Privacy Policy' }).getAttribute('href'),
    ).toBe('/privacy');
    expect(within(legalNav).getByRole('link', { name: 'Cookies' }).getAttribute('href')).toBe(
      '/privacy#cookies',
    );
    expect(
      within(legalNav).getByRole('link', { name: 'Terms of Service' }).getAttribute('href'),
    ).toBe('/terms');
    expect(within(legalNav).getByRole('link', { name: 'Trust' }).getAttribute('href')).toBe(
      '/trust',
    );

    const resourcesNav = screen.getByRole('navigation', { name: 'Resources' });
    expect(within(resourcesNav).getByRole('heading', { name: 'Resources' })).toBeTruthy();
    expect(within(resourcesNav).getByRole('link', { name: 'Contact' }).getAttribute('href')).toBe(
      '/#contact',
    );

    const github = within(resourcesNav).getByRole('link', { name: 'GitHub' });
    expect(github.getAttribute('href')).toBe('https://github.com/assurly/assurly');
    expect(github.getAttribute('target')).toBe('_blank');
    expect(github.getAttribute('rel')).toContain('noopener');

    const npm = within(resourcesNav).getByRole('link', { name: 'npm — assurly' });
    expect(npm.getAttribute('href')).toBe('https://www.npmjs.com/package/assurly');
    expect(npm.getAttribute('rel')).toContain('noreferrer');

    const brand = document.querySelector('.site-footer__brand-link');
    expect(brand?.textContent).toBe('Assurly');
    expect(brand?.querySelector('.site-footer__wordmark span')?.textContent).toBe('url');
  });

  it('renders the compact dashboard footer with legal links and contact', () => {
    render(<SiteFooter variant="compact" />);

    const footer = screen.getByRole('contentinfo', { name: 'Assurly dashboard footer' });
    expect(footer).toBeTruthy();
    expect(within(footer).getByText('© 2026 Assurly. All rights reserved.')).toBeTruthy();
    expect(within(footer).getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe(
      '/privacy',
    );
    expect(within(footer).getByRole('link', { name: 'Cookies' }).getAttribute('href')).toBe(
      '/privacy#cookies',
    );
    expect(
      within(footer).getByRole('link', { name: 'Terms of Service' }).getAttribute('href'),
    ).toBe('/terms');
    expect(within(footer).getByRole('link', { name: 'Contact' }).getAttribute('href')).toBe(
      '/#contact',
    );
    expect(within(footer).queryByRole('link', { name: 'Trust' })).toBeNull();
  });
});
