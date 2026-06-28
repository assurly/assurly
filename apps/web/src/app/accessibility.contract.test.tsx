import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import HomeClient from './_components/home/HomeClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
import ManualChecker from './dashboard/_components/manual-checker/ManualChecker';
import PrivacyPage from './privacy/page';
import TermsPage from './terms/page';

const globalsCss = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const tokensCss = readFileSync(new URL('./design-tokens.css', import.meta.url), 'utf8');

function expectNamedFormControls(html: string): void {
  const controls = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)];
  expect(controls.length).toBeGreaterThan(0);

  for (const [, tag, attributes] of controls) {
    if (/type="hidden"/.test(attributes)) continue;
    const ariaLabelled = /aria-label(?:ledby)?="[^"]+"/.test(attributes);
    const id = attributes.match(/\sid="([^"]+)"/)?.[1];
    const labelled = id ? html.includes(`for="${id}"`) : false;
    expect(ariaLabelled || labelled, `${tag} is missing an accessible label: ${attributes}`).toBe(
      true,
    );
  }
}

function expectNamedButtons(html: string): void {
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  expect(buttons.length).toBeGreaterThan(0);

  for (const [, attributes, children] of buttons) {
    const text = children
      .replace(/<[^>]+>/g, '')
      .replace(/&[^;]+;/g, ' ')
      .trim();
    expect(
      /aria-label="[^"]+"/.test(attributes) || text.length > 0,
      `button is missing an accessible name: ${attributes}`,
    ).toBe(true);
  }
}

describe('accessibility and responsive UI contracts', () => {
  it('gives landing-page controls programmatic labels and names', () => {
    const html = renderToStaticMarkup(<HomeClient initialAuthenticated={false} />);
    expectNamedFormControls(html);
    expectNamedButtons(html);
    expect(html).toContain('aria-controls="primary-navigation"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('role="group" aria-label="Billing period"');
  });

  it('gives manual scanner editors labels and a keyboard-operable tab contract', () => {
    const html = renderToStaticMarkup(<ManualChecker />);
    expectNamedFormControls(html);
    expectNamedButtons(html);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-controls="manual-panel-sql"');
    expect(html).toContain('role="tabpanel"');
  });

  it('centralizes UI primitives and keeps focus, touch, and reduced-motion safeguards', () => {
    expect(tokensCss).toContain('--touch-target: 44px');
    expect(tokensCss).toContain('--color-focus: var(--color-accent)');
    expect(tokensCss).toContain('--focus-ring:');
    expect(globalsCss).toContain('.cookie-notice');
    expect(tokensCss).toContain('--space-4:');
    expect(globalsCss).toContain(':focus-visible');
    expect(globalsCss).toContain('min-height: var(--touch-target)');
    expect(globalsCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(globalsCss).toContain('animation-duration: 0.01ms !important');
    expect(globalsCss).toContain('.pricing-grid');
    expect(globalsCss).toContain('grid-template-columns: 1fr');
    expect(globalsCss).toContain('button *');
    expect(globalsCss).toContain('cursor: inherit');
    expect(globalsCss).toContain('.profile-trigger-btn *');
    expect(globalsCss).toMatch(/\.profile-trigger-btn \*[\s\S]*cursor:\s*pointer/);
  });

  it('states the server transit boundary consistently on both legal pages', () => {
    const privacy = renderToStaticMarkup(<PrivacyPage />);
    const terms = renderToStaticMarkup(<TermsPage />);
    expect(privacy).toContain('passes transiently through ShipReady');
    expect(privacy).toContain('do not store complete repository source files');
    expect(privacy).not.toContain('never leave your device');
    expect(terms).toContain('transmit repository content through ShipReady');
  });
});
