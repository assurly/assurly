import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import HomeClient from './_components/home/HomeClient';

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string): string | null => {
      if (name === 'host') return 'localhost:3000';
      if (name === 'cookie') return '';
      return null;
    },
  }),
}));

vi.mock('./utils/auth', () => ({
  getSessionUser: vi.fn(async () => null),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
import ManualChecker from './dashboard/_components/manual-checker/ManualChecker';
import McpPage from './mcp/page';
import PrivacyPage from './privacy/page';
import TermsPage from './terms/page';

async function renderMcpPageHtml(): Promise<string> {
  process.env.APP_URL = process.env.APP_URL?.trim() || 'http://localhost:3000';
  const element = (await McpPage()) as ReactElement;
  return renderToStaticMarkup(element);
}

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

  it('gives MCP page copy controls and install tabs accessible names', async () => {
    const html = await renderMcpPageHtml();
    expectNamedButtons(html);
    expect(html).toContain('hamburger-btn');
    expect(html).toContain('aria-controls="primary-navigation"');
    expect(html).toContain('aria-label="Open navigation"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-controls="mcp-install-panel-cursor"');
    expect(html).toContain('aria-controls="mcp-install-panel-claude"');
    expect(html).toContain('aria-controls="mcp-install-panel-vscode"');
    expect(html).toContain('aria-controls="mcp-install-panel-windsurf"');
    expect(html).toContain('aria-controls="mcp-install-panel-other"');
    expect(html).toContain('id="mcp-install-panel-cursor"');
    expect(html).toContain('id="mcp-install-panel-claude"');
    expect(html).toContain('id="mcp-install-panel-vscode"');
    expect(html).toContain('id="mcp-install-panel-windsurf"');
    expect(html).toContain('id="mcp-install-panel-other"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-label="Copy');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="One-click install"');
    expect(html).toContain('Add to Cursor');
    expect(html).toContain('Add to VS Code');
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

  it('never lets a contextual link rule repaint a button label', () => {
    // This bug class has shipped twice: the "Save ~35%" badge went accent-on-accent
    // inside the selected billing toggle, and `.mcp-section a` (0,1,1) outranked
    // `.mcp-one-click-btn--primary` (0,1,0) and painted the button's label green on
    // its own green background — contrast 1:1, the label simply gone. Both times the
    // component looked correct in isolation and broke only in one context.
    //
    // A generic descendant link rule must therefore exclude buttons rather than
    // rely on every button out-specifying it.
    const sectionLinkRules = [...globalsCss.matchAll(/^\s*\.mcp-section a([^{,]*)\s*[,{]/gm)].map(
      (match) => match[1].trim(),
    );
    expect(sectionLinkRules.length).toBeGreaterThan(0);
    for (const qualifier of sectionLinkRules) {
      expect(
        qualifier.includes(':not(.mcp-one-click-btn)'),
        `\`.mcp-section a${qualifier}\` is unscoped and will repaint button labels`,
      ).toBe(true);
    }
  });

  it('unifies /mcp hover fills without collapsing copied, selected, or current states', () => {
    // Accent fill without a dark label is the same failure mode as above:
    // --text-primary on --color-accent measures 1.64:1. Every filled hover /
    // focus-visible block must flip to --color-canvas in the same declaration.
    const declarationBlocks = [...globalsCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
      selectors: match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      body: match[2],
    }));

    const mcpFillControls = ['.mcp-one-click-btn', '.code-block-copy', '.mcp-install-tab'];
    const filledBlocks = declarationBlocks.filter(
      ({ selectors, body }) =>
        mcpFillControls.some((control) => selectors.includes(control)) &&
        /background-color:\s*var\(--color-accent\)/.test(body),
    );
    expect(filledBlocks.length).toBeGreaterThan(0);
    for (const { selectors, body } of filledBlocks) {
      expect(
        /color:\s*var\(--color-canvas\)/.test(body),
        `Accent fill on \`${selectors}\` is missing color: var(--color-canvas)`,
      ).toBe(true);
      expect(
        /color:\s*var\(--text-primary\)/.test(body),
        `Accent fill on \`${selectors}\` still sets --text-primary (1.64:1)`,
      ).toBe(false);
    }

    // Copied / failed are outline feedback — hovering must not paint them as a
    // filled hover. The hover selector excludes those modifiers.
    expect(globalsCss).toMatch(
      /\.code-block-copy:hover:not\(\.code-block-copy--copied\):not\(\.code-block-copy--failed\)/,
    );
    expect(globalsCss).toMatch(
      /\.code-block-copy:focus-visible:not\(\.code-block-copy--copied\):not\(\.code-block-copy--failed\)/,
    );
    expect(globalsCss).toMatch(
      /\.code-block-copy--copied\s*\{[^}]*background-color:\s*var\(--color-surface\)/,
    );
    expect(globalsCss).toMatch(
      /\.code-block-copy--failed\s*\{[^}]*background-color:\s*var\(--color-surface\)/,
    );

    // Selected tab rests on a surface, never accent, and hover excludes active.
    expect(globalsCss).toMatch(
      /\.mcp-install-tab--active\s*\{[^}]*background-color:\s*var\(--color-surface-subtle\)/,
    );
    expect(globalsCss).not.toMatch(
      /\.mcp-install-tab--active\s*\{[^}]*background-color:\s*var\(--color-accent\)/,
    );
    expect(globalsCss).toMatch(/\.mcp-install-tab:hover:not\(\.mcp-install-tab--active\)/);

    // /mcp reuses the landing primary nav — text links, hamburger ≤768px, no chip fills.
    expect(globalsCss).toMatch(/\.hamburger-btn\s*\{/);
    expect(globalsCss).toMatch(/#primary-navigation a\s*\{[^}]*min-width:\s*var\(--touch-target\)/);
    expect(globalsCss).toMatch(/header nav a\s*\{[^}]*min-height:\s*var\(--touch-target\)/);
    const primaryNavHoverFill = declarationBlocks.some(
      ({ selectors, body }) =>
        (selectors.includes('#primary-navigation') || selectors.includes('header nav a')) &&
        /:hover/.test(selectors) &&
        /background-color:\s*var\(--color-accent\)/.test(body),
    );
    expect(primaryNavHoverFill).toBe(false);

    // Filled / accent hovers must not stick on touch devices.
    expect(globalsCss).toMatch(
      /@media\s*\(\s*hover:\s*hover\s*\)\s*\{[\s\S]*?\.code-block-copy:hover:not\(\.code-block-copy--copied\):not\(\.code-block-copy--failed\)/,
    );
    expect(globalsCss).toMatch(
      /@media\s*\(\s*hover:\s*hover\s*\)\s*\{[\s\S]*?\.mcp-install-tab:hover:not\(\.mcp-install-tab--active\)/,
    );

    // Touch targets and focus rings stay intact for the unified MCP controls.
    for (const control of ['.code-block-copy', '.mcp-install-tab']) {
      expect(globalsCss).toMatch(
        new RegExp(
          `${control.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*min-height:\\s*var\\(--touch-target\\)`,
        ),
      );
      expect(globalsCss).toMatch(
        new RegExp(
          `${control.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:focus-visible\\s*\\{[^}]*outline:`,
        ),
      );
    }
  });

  it('states the server transit boundary consistently on both legal pages', () => {
    const privacy = renderToStaticMarkup(<PrivacyPage />);
    const terms = renderToStaticMarkup(<TermsPage />);
    expect(privacy).toContain('passes transiently through Assurly');
    expect(privacy).toContain('do not store complete repository source files');
    expect(privacy).not.toContain('never leave your device');
    expect(terms).toContain('transmit repository content through Assurly');
  });
});
