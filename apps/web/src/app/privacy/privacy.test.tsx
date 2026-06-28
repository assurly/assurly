// @vitest-environment jsdom

import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PrivacyPage from './page';
import TermsPage from '../terms/page';

describe('Legal Pages Component Structure', () => {
  it('PrivacyPage returns a valid React structure with processing disclosures', () => {
    const component = PrivacyPage();
    expect(component).toBeDefined();
    expect(component.type).toBe('div');
    expect(component.props.className).toBe('legal-container');

    const main = component.props.children[1];
    expect(main.type).toBe('main');

    const h1 = main.props.children[0];
    expect(h1.props.children).toBe('Privacy Policy');
  });

  it('PrivacyPage renders cookie inventory section', () => {
    render(<PrivacyPage />);
    const cookiesSection = document.getElementById('cookies');
    expect(cookiesSection).toBeTruthy();

    expect(
      within(cookiesSection!).getByRole('heading', {
        name: /6\. Cookies and Similar Technologies/i,
      }),
    ).toBeTruthy();
    expect(within(cookiesSection!).getByRole('table')).toBeTruthy();
    expect(within(cookiesSection!).getAllByText(/shipready-session/).length).toBeGreaterThan(0);
  });

  it('TermsPage returns a valid React structure with warranty disclaimer headings', () => {
    const component = TermsPage();
    expect(component).toBeDefined();
    expect(component.type).toBe('div');
    expect(component.props.className).toBe('legal-container');

    // Check main tag structure
    const main = component.props.children[1];
    expect(main.type).toBe('main');

    // Verify presence of title
    const h1 = main.props.children[0];
    expect(h1.props.children).toBe('Terms of Service');
  });
});
