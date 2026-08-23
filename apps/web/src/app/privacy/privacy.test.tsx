// @vitest-environment jsdom

import { render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string): string | null => {
      if (name === 'host') return 'localhost:3000';
      if (name === 'cookie') return '';
      return null;
    },
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

import PrivacyPage from './page';
import TermsPage from '../terms/page';

async function renderPrivacy() {
  process.env.APP_URL = process.env.APP_URL?.trim() || 'http://localhost:3000';
  return render(await PrivacyPage());
}

async function renderTerms() {
  process.env.APP_URL = process.env.APP_URL?.trim() || 'http://localhost:3000';
  return render(await TermsPage());
}

/**
 * These assertions used to index `children[1]` for the `<main>` element, so
 * adding anything ahead of it in the tree — a JSON-LD block, in the event —
 * failed them for a reason that had nothing to do with what they check.
 * Querying the rendered output keeps the same guarantee without pinning the
 * order of siblings.
 */
describe('Legal Pages Component Structure', () => {
  it('PrivacyPage returns a valid React structure with processing disclosures', async () => {
    // Scoped to this render's own container: the suite renders both legal pages
    // into one jsdom document, so a global query finds two of everything.
    const { container } = await renderPrivacy();

    expect(container.querySelector('div.legal-container')).toBeTruthy();
    const main = within(container).getByRole('main');
    expect(within(main).getByRole('heading', { level: 1 }).textContent).toBe('Privacy Policy');
  });

  it('PrivacyPage renders cookie inventory section', async () => {
    await renderPrivacy();
    const cookiesSection = document.getElementById('cookies');
    expect(cookiesSection).toBeTruthy();

    expect(
      within(cookiesSection!).getByRole('heading', {
        name: /10\. Cookies and Similar Technologies/i,
      }),
    ).toBeTruthy();
    expect(within(cookiesSection!).getByRole('table')).toBeTruthy();
    expect(within(cookiesSection!).getAllByText(/assurly-session/).length).toBeGreaterThan(0);
  });

  it('TermsPage returns a valid React structure with warranty disclaimer headings', async () => {
    const { container } = await renderTerms();

    expect(container.querySelector('div.legal-container')).toBeTruthy();
    const main = within(container).getByRole('main');
    expect(within(main).getByRole('heading', { level: 1 }).textContent).toBe('Terms of Service');
  });

  it('Privacy and Terms both disclose the 3-day Pro trial', async () => {
    const privacy = await renderPrivacy();
    const terms = await renderTerms();

    expect(within(privacy.container).getByRole('main').textContent).toMatch(/3-day free trial/);
    expect(within(terms.container).getByRole('main').textContent).toMatch(/3-day free trial/);
  });

  it('uses the landing hamburger chrome so the theme toggle is not a second header row', async () => {
    const privacy = await renderPrivacy();
    const terms = await renderTerms();

    for (const { container } of [privacy, terms]) {
      expect(container.querySelector('.legal-header')).toBeNull();
      expect(container.querySelector('.hamburger-btn')).toBeTruthy();
      expect(container.querySelector('.site-header')).toBeTruthy();
      expect(container.querySelector('nav .theme-toggle')).toBeTruthy();
      expect(
        within(container)
          .getByRole('button', { name: 'Open navigation' })
          .getAttribute('aria-controls'),
      ).toBe('primary-navigation');
    }
  });
});
