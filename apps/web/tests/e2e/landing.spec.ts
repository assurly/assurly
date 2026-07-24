import { expect, test } from '@playwright/test';

test.describe('Landing page', () => {
  test('hero focuses on URL scan, fixing, and trust — not static analysis', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('h1')).toContainText('Before you ship your AI-built SaaS');
    await expect(page.locator('h1')).toContainText('what will break in production');
    await expect(page.locator('.hero-subtitle')).toContainText('Ship Score');
    await expect(page.locator('.hero-subtitle')).not.toContainText('static analysis');
  });

  test('how-it-works section covers URL scan through monitoring', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const section = page.locator('#how-it-works');
    await expect(section.locator('h2')).toHaveText('How It Works');
    await expect(section.getByRole('heading', { name: 'URL Scan' })).toBeVisible();
    await expect(section.getByRole('heading', { name: 'Ship Score' })).toBeVisible();
    await expect(section.getByRole('heading', { name: 'One-Click Fix' })).toBeVisible();
    await expect(section.getByRole('heading', { name: 'Continuous Monitoring' })).toBeVisible();
    await expect(section.locator('.feature-step-numeral')).toHaveCount(4);
  });

  test('pricing cards show Free, Guard, and Agency value bullets', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const pricing = page.locator('#pricing');
    await expect(pricing.locator('.pricing-card h3').nth(0)).toHaveText('Free');
    await expect(pricing.locator('.pricing-card h3').nth(1)).toHaveText('Guard');
    await expect(pricing.locator('.pricing-card h3').nth(2)).toHaveText('Agency');
    await expect(pricing.locator('.pricing-badge')).toHaveText('Most Popular');

    await expect(pricing.getByText('MCP server access for AI agents')).toBeVisible();
    await expect(pricing.getByText('Monitoring on every deploy')).toBeVisible();
    await expect(pricing.getByText('White-label PDF audit reports')).toBeVisible();
    await expect(pricing.getByText(/scan rules/i)).toHaveCount(0);
  });

  test('EUR prices differ from USD — not a 1:1 copy', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const guardPrice = page.locator('#pricing .pricing-card.featured .pricing-amount');
    await expect(guardPrice).toHaveText('$19');

    const eurToggle = page.getByRole('button', { name: 'EUR (€)' }).first();
    await expect(eurToggle).toBeVisible();

    // Client hydration can lag under parallel E2E load — retry click until prices update.
    await expect(async () => {
      await eurToggle.click();
      await expect(guardPrice).toHaveText('€17');
    }).toPass();
  });

  test('footer does not mention exit readiness', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('footer')).not.toContainText(/exit readiness/i);
    await expect(page.locator('footer')).toContainText(
      'Know what will break in production — before you deploy.',
    );
  });

  test('testimonials omit fabricated aggregate metrics', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.testimonials-trust-bar')).toHaveCount(0);
    await expect(page.getByText(/500\+/)).toHaveCount(0);
    await expect(page.getByText(/12,000\+/)).toHaveCount(0);
  });

  test('head carries title, description, OG, Twitter, canonical, and OG image', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const headMeta = await page.evaluate(() => {
      const getMeta = (selector: string): string | null =>
        document.querySelector<HTMLMetaElement>(selector)?.content ?? null;

      return {
        title: document.title,
        description: getMeta('meta[name="description"]'),
        ogTitle: getMeta('meta[property="og:title"]'),
        ogDescription: getMeta('meta[property="og:description"]'),
        ogImage: getMeta('meta[property="og:image"]'),
        twitterCard: getMeta('meta[name="twitter:card"]'),
        twitterTitle: getMeta('meta[name="twitter:title"]'),
        canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null,
      };
    });

    expect(headMeta.title).toContain('Pre-deploy Ship Gate');
    expect(headMeta.description).toContain('Ship Score');
    expect(headMeta.ogTitle).toContain('Pre-deploy Ship Gate');
    expect(headMeta.ogDescription).toContain('Ship Score');
    expect(headMeta.ogImage).toBeTruthy();
    expect(headMeta.twitterCard).toBe('summary_large_image');
    expect(headMeta.twitterTitle).toContain('Pre-deploy Ship Gate');
    expect(headMeta.canonical).toMatch(/\/$/);
  });
});
