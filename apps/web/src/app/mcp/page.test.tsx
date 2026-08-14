// Runs in the default node environment on purpose. The page is rendered with
// renderToStaticMarkup, which needs no DOM, and under a browser-like environment
// `import.meta.url` becomes an http URL that readFileSync cannot resolve.
// (Do not add an environment docblock above — vitest matches the directive
// anywhere in the leading comments, including inside a sentence about it.)
import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string): string | null => {
      if (name === 'host') return 'localhost:3000';
      if (name === 'cookie') return '';
      return null;
    },
  }),
}));

vi.mock('../../utils/auth', () => ({
  getSessionUser: vi.fn(async () => null),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

import McpPage from './page';

/**
 * The tool names the MCP server actually registers, read from the package source
 * rather than duplicated here.
 *
 * This page once documented three tools while the server shipped four —
 * `assurly_verdict`, the tool that needs an API key and leads to a paid plan, was
 * missing. Nothing failed, because nothing was checking. Deriving the list from
 * `packages/mcp-server` makes that drift a test failure instead of a silent gap
 * on a page linked from the primary navigation.
 */
function registeredToolNames(): string[] {
  const source = readFileSync(
    new URL('../../../../../packages/mcp-server/src/tools.ts', import.meta.url),
    'utf8',
  );
  const block = source.match(/ASSURLY_MCP_TOOL_NAMES\s*=\s*\[([\s\S]*?)\]/)?.[1];
  if (!block) throw new Error('Could not find ASSURLY_MCP_TOOL_NAMES in the MCP server source.');
  return [...block.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

async function renderMcpPageHtml(): Promise<string> {
  const element = (await McpPage()) as ReactElement;
  return renderToStaticMarkup(element);
}

describe('McpPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = 'http://localhost:3000';
  });

  it('documents every tool the MCP server registers', async () => {
    const html = await renderMcpPageHtml();
    const names = registeredToolNames();

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(html).toContain(name);
    }
  });

  it('does not understate the tool count in the setup copy', async () => {
    const html = await renderMcpPageHtml();
    const count = registeredToolNames().length;
    const spelled = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'][count];

    // The Cursor step tells the reader how many `assurly_*` tools should appear.
    // If that number goes stale, the reader concludes the install half-failed.
    expect(html).toContain(`the ${spelled} `);
  });

  it('renders code snippets as scrollable, keyboard-reachable regions', async () => {
    const html = await renderMcpPageHtml();
    // `.code-block` carries `overflow-x: auto`; without it the page-level
    // `overflow-x: clip` silently truncated the install command on phones.
    const blocks = html.match(/class="code-block"/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('tabindex="0"');
  });

  it('surfaces the blocked-verdict isError differentiator and real tool output', async () => {
    const html = await renderMcpPageHtml();
    expect(html).toContain('What your agent gets back');
    expect(html).toContain('isError: true');
    expect(html).toContain('Assurly verdict: BLOCKED · Ship Score 42/100');
    expect(html).toContain('Fix outcomes (last re-probe only');
    expect(html).toContain('observed 2026-07-18T06:00:00.000Z');
    expect(html).toContain('An unverified claim is not done');
    expect(html).toContain('REVIEW RECOMMENDED');
    expect(html).toContain('Make the gate automatic');
    expect(html).toContain('deploy and re-probe');
    expect(html).toContain('Connect the hosted verdict');
    expect(html).toContain('ASSURLY_API_KEY');
    expect(html).toContain('^20.19.0 || &gt;=22.12.0');
    expect(html).toContain(
      'ASSURLY_API_KEY is not set. Create a key in the Assurly dashboard (Settings → API keys) and expose it to this MCP server as ASSURLY_API_KEY.',
    );
    expect(html).toContain('Provide exactly one of `url` or `repo`.');
  });

  it('renders install as a tabbed client picker, not separate Cursor/Claude sections', async () => {
    const html = await renderMcpPageHtml();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('mcp-install-tab-cursor');
    expect(html).toContain('mcp-install-tab-vscode');
    expect(html).not.toMatch(/<h2>Cursor<\/h2>/);
    expect(html).not.toMatch(/<h2>Claude Code<\/h2>/);
  });

  it('uses a product layout, not the legal-document shell', async () => {
    const html = await renderMcpPageHtml();
    expect(html).toContain('mcp-container');
    expect(html).toContain('mcp-hero');
    expect(html).toContain('mcp-content');
    expect(html).not.toContain('legal-container');
    expect(html).not.toContain('legal-content');
    expect(html).not.toContain('legal-section');
    expect(html).not.toContain('Back to Home');
    expect(html).not.toContain('last-updated');
  });

  it('renders a hero with install command, one-click deeplinks, and npm version', async () => {
    const html = await renderMcpPageHtml();
    const version = JSON.parse(
      readFileSync(
        new URL('../../../../../packages/mcp-server/package.json', import.meta.url),
        'utf8',
      ),
    ).version as string;

    expect(html).toContain('npx -y @assurly/mcp-server');
    expect(html).toContain(
      'href="cursor://anysphere.cursor-deeplink/mcp/install?name=assurly&amp;config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBhc3N1cmx5L21jcC1zZXJ2ZXIiXX0="',
    );
    expect(html).toContain(
      'href="https://vscode.dev/redirect/mcp/install?name=assurly&amp;config=%7B%22name%22%3A%22assurly%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40assurly%2Fmcp-server%22%5D%7D"',
    );
    expect(html).toContain('Add to Cursor');
    expect(html).toContain('Add to VS Code');
    expect(html).toContain('https://www.npmjs.com/package/@assurly/mcp-server');
    expect(html).toContain(`v${version}`);
    const toolCount = registeredToolNames().length;
    expect(html).toContain(`free · ${toolCount} tools · MIT`);
    // One-click buttons appear in the hero and again at the top of Install.
    expect(html.match(/Add to Cursor/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('shares the landing primary-nav contract (hamburger + /# anchors)', async () => {
    const html = await renderMcpPageHtml();
    expect(html).toContain('hamburger-btn');
    expect(html).toContain('aria-controls="primary-navigation"');
    expect(html).toContain('aria-label="Open navigation"');
    const nav = html.match(/aria-label="Primary navigation"[\s\S]*?<\/nav>/)?.[0];
    expect(nav).toBeTruthy();
    expect(nav).toContain('href="/#faq"');
    expect(nav).toMatch(/MCP Server[\s\S]*FAQ[\s\S]*Contact/);
    expect(nav).toContain('aria-current="page"');
    expect(html).toContain('Sign In');
  });

  it('renders the typical agent loop as a visual flow, not a bare numbered list', async () => {
    const html = await renderMcpPageHtml();
    expect(html).toContain('mcp-agent-loop');
    expect(html).toContain('READY TO SHIP');
    expect(html).toContain('assurly_explain_rule');
  });
});
