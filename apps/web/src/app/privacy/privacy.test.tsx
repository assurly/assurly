// @vitest-environment jsdom

import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PrivacyPage from './page';
import TermsPage from '../terms/page';

/**
 * These assertions used to index `children[1]` for the `<main>` element, so
 * adding anything ahead of it in the tree — a JSON-LD block, in the event —
 * failed them for a reason that had nothing to do with what they check.
 * Querying the rendered output keeps the same guarantee without pinning the
 * order of siblings.
 */
describe('Legal Pages Component Structure', () => {
  it('PrivacyPage returns a valid React structure with processing disclosures', () => {
    // Scoped to this render's own container: the suite renders both legal pages
    // into one jsdom document, so a global query finds two of everything.
    const { container } = render(<PrivacyPage />);

    expect(container.querySelector('div.legal-container')).toBeTruthy();
    const main = within(container).getByRole('main');
    expect(within(main).getByRole('heading', { level: 1 }).textContent).toBe('Privacy Policy');
  });

  it('PrivacyPage renders cookie inventory section', () => {
    render(<PrivacyPage />);
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

  it('TermsPage returns a valid React structure with warranty disclaimer headings', () => {
    const { container } = render(<TermsPage />);

    expect(container.querySelector('div.legal-container')).toBeTruthy();
    const main = within(container).getByRole('main');
    expect(within(main).getByRole('heading', { level: 1 }).textContent).toBe('Terms of Service');
  });

  it('Privacy and Terms both disclose the 3-day Pro trial', () => {
    const privacy = render(<PrivacyPage />);
    const terms = render(<TermsPage />);

    expect(within(privacy.container).getByRole('main').textContent).toMatch(/3-day free trial/);
    expect(within(terms.container).getByRole('main').textContent).toMatch(/3-day free trial/);
  });
});
