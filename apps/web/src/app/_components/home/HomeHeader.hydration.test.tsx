// @vitest-environment jsdom

import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeHeader } from './HomeHeader';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const baseProps = {
  authenticated: false,
  loginUrl: 'http://localhost:3000/api/auth/login',
  menuOpen: false,
  onMenuChange: vi.fn(),
};

function collectHydrationErrors(run: () => void): string[] {
  const hydrationErrors: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const message = args.map(String).join(' ');
    if (/hydration|did not match/i.test(message)) {
      hydrationErrors.push(message);
    }
    originalConsoleError(...args);
  };

  try {
    run();
  } finally {
    console.error = originalConsoleError;
  }

  return hydrationErrors;
}

describe('HomeHeader — hydration contract', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('hydrates closed menu markup without React hydration warnings', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const markup = renderToString(<HomeHeader {...baseProps} />);
    container.innerHTML = markup;

    const hydrationErrors = collectHydrationErrors(() => {
      hydrateRoot(container, <HomeHeader {...baseProps} />);
    });

    expect(hydrationErrors).toEqual([]);
  });

  it('hydrates open menu markup without React hydration warnings', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const openProps = { ...baseProps, menuOpen: true };
    const markup = renderToString(<HomeHeader {...openProps} />);
    container.innerHTML = markup;

    const hydrationErrors = collectHydrationErrors(() => {
      hydrateRoot(container, <HomeHeader {...openProps} />);
    });

    expect(hydrationErrors).toEqual([]);
  });

  it('renders stable class names when the menu is closed', () => {
    const html = renderToString(<HomeHeader {...baseProps} />);

    expect(html).toContain('id="primary-navigation"');
    expect(html).not.toContain('class="open"');
    expect(html).not.toContain('class=""');
    expect(html).not.toMatch(/<nav[^>]*class=""/);
    expect(html).not.toContain('site-header-menu-open');
    expect(html).toContain('href="#features"');
    expect(html).toContain('class="bar"');
    expect(html).not.toContain('class="bar open"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('renders open-state classes consistently on server markup', () => {
    const html = renderToString(<HomeHeader {...baseProps} menuOpen />);

    expect(html).toContain('site-header-menu-open');
    expect(html).toContain('class="open"');
    expect(html).toContain('class="bar open"');
    expect(html).toContain('aria-expanded="true"');
  });

  it('renders primary nav links in a deterministic order', () => {
    const html = renderToString(<HomeHeader {...baseProps} />);
    const featuresIndex = html.indexOf('href="#features"');
    const pricingIndex = html.indexOf('href="#pricing"');
    const contactIndex = html.indexOf('href="#contact"');

    expect(featuresIndex).toBeGreaterThan(-1);
    expect(pricingIndex).toBeGreaterThan(featuresIndex);
    expect(contactIndex).toBeGreaterThan(pricingIndex);
  });
});
