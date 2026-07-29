import { expect, test } from '@playwright/test';

test.describe('MCP public page', () => {
  test('renders tool table and copy-paste configs', async ({ page }) => {
    await page.goto('/mcp', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('h1')).toHaveText('Assurly MCP Server');
    await expect(page.getByRole('columnheader', { name: 'Tool' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'assurly_scan_path' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'assurly_scan_files' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'assurly_explain_rule' })).toBeVisible();

    // Address each block by its accessible name. Indexing `pre code` positionally
    // broke silently the moment a new snippet was added above the install tabs,
    // and the failure pointed at the wrong block.
    await expect(page.getByRole('region', { name: 'Install command' })).toHaveText(
      'npx -y @assurly/mcp-server',
    );

    const cursorConfig = page.getByRole('region', { name: 'Cursor MCP configuration' });
    await expect(cursorConfig).toContainText('"command": "npx"');
    await expect(cursorConfig).toContainText('"@assurly/mcp-server"');

    await page.getByRole('tab', { name: 'Claude Code' }).click();
    await expect(page.getByRole('region', { name: 'Claude Code install command' })).toHaveText(
      'claude mcp add assurly -- npx -y @assurly/mcp-server',
    );
  });

  test('homepage nav link navigates to the MCP page in one click', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'MCP Server' })
      .click();
    await expect(page).toHaveURL(/\/mcp$/);
    await expect(page.locator('h1')).toHaveText('Assurly MCP Server');
  });

  test('head carries title, description, OG, Twitter, and canonical meta tags', async ({
    page,
  }) => {
    await page.goto('/mcp', { waitUntil: 'domcontentloaded' });

    const headMeta = await page.evaluate(() => {
      const getMeta = (selector: string): string | null =>
        document.querySelector<HTMLMetaElement>(selector)?.content ?? null;

      return {
        title: document.title,
        description: getMeta('meta[name="description"]'),
        ogTitle: getMeta('meta[property="og:title"]'),
        ogDescription: getMeta('meta[property="og:description"]'),
        twitterCard: getMeta('meta[name="twitter:card"]'),
        twitterTitle: getMeta('meta[name="twitter:title"]'),
        canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null,
      };
    });

    expect(headMeta.title).toContain('Assurly MCP Server');
    expect(headMeta.description).toContain('ship gate AI agents call before deploy');
    expect(headMeta.ogTitle).toContain('Assurly MCP Server');
    expect(headMeta.ogDescription).toContain('ship gate AI agents call before deploy');
    expect(headMeta.twitterCard).toBe('summary_large_image');
    expect(headMeta.twitterTitle).toContain('Assurly MCP Server');
    expect(headMeta.canonical).toMatch(/\/mcp$/);
  });
});
