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

  test('pricing cards show Free, Pro, and OEM value bullets', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const pricing = page.locator('#pricing');
    await expect(pricing.locator('.pricing-card h3').nth(0)).toHaveText('Free');
    await expect(pricing.locator('.pricing-card h3').nth(1)).toHaveText('Pro');
    await expect(pricing.locator('.pricing-card h3').nth(2)).toHaveText('OEM / Platform');
    await expect(pricing.locator('.pricing-badge')).toHaveText('Most Popular');

    // One bullet unique to each tier, so a card silently losing its headline
    // benefit fails here rather than in a customer's expectations.
    await expect(pricing.getByText('MCP server access for AI agents')).toBeVisible();
    await expect(
      pricing.getByText('Continuous Guardian on every deploy', { exact: true }),
    ).toBeVisible();
    await expect(pricing.getByText('Keyed verdict API for your users')).toBeVisible();
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

  test('SEO & GEO Audit section is present with a real outline heading', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const section = page.locator('#seo-geo-audit');
    await expect(section).toBeVisible();
    await expect(section.locator('#seo-geo-heading')).toHaveText(
      'Your app can look fine and still be invisible to AI',
    );

    const outline = await page.evaluate(() =>
      [...document.querySelectorAll('h1, h2, h3')].map((el) => ({
        tag: el.tagName,
        id: el.id,
        text: el.textContent?.trim() ?? '',
      })),
    );
    expect(
      outline.some(
        (heading) =>
          heading.tag === 'H2' &&
          heading.id === 'seo-geo-heading' &&
          /invisible to AI/i.test(heading.text),
      ),
    ).toBe(true);

    const copy = (await section.innerText()).toLowerCase();
    expect(copy).toContain('canonical');
    expect(copy).toContain('llms.txt');
    expect(copy).toContain('structured data');
    expect(copy).not.toMatch(/trusted by/);
    expect(copy).not.toMatch(/\d+%/);
    expect(copy).not.toMatch(/chatgpt ranking/);
  });

  test('SEO & GEO FAQ entry appears in the accordion and FAQPage JSON-LD', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const faqItem = page.getByTestId('faq-seo-geo-audit');
    await expect(faqItem).toBeVisible();
    await expect(faqItem.locator('summary')).toContainText('What is the SEO & GEO Audit?');

    const html = await (await page.request.get('/')).text();
    const payload =
      html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? '';
    const graph = JSON.parse(payload.replace(/\\u003c/g, '<'))['@graph'] as Array<{
      '@type': string;
      mainEntity?: Array<{ name?: string; acceptedAnswer?: { text?: string } }>;
    }>;
    const faqPage = graph.find((node) => node['@type'] === 'FAQPage');
    expect(faqPage).toBeTruthy();
    const questions = faqPage?.mainEntity ?? [];
    const seoGeo = questions.find((entry) => /SEO & GEO Audit/i.test(entry.name ?? ''));
    expect(seoGeo, 'FAQPage JSON-LD missing SEO & GEO question').toBeTruthy();
    expect(seoGeo?.acceptedAnswer?.text ?? '').toMatch(/AI Readiness Score/i);
    expect(seoGeo?.acceptedAnswer?.text ?? '').not.toMatch(/ChatGPT ranking/i);
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
