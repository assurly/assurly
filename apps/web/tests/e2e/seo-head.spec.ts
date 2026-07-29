import { expect, test } from '@playwright/test';

/**
 * sitemap.ts asks search engines to index a specific list of pages. A page that
 * inherits the root layout's `alternates.canonical: '/'` tells them the opposite
 * — that it is a duplicate of the homepage — and the canonical wins, so the
 * sitemap entry is silently discarded.
 *
 * /privacy, /terms and /trust all shipped in exactly that state. Nothing failed,
 * because nothing compared the two. This does.
 */
test.describe('SEO head metadata', () => {
  test('every page in the sitemap declares itself canonical', async ({ page, baseURL }) => {
    const sitemap = await (await page.request.get('/sitemap.xml')).text();
    const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => new URL(match[1]).pathname,
    );

    expect(paths.length).toBeGreaterThan(0);

    for (const path of paths) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      const canonical = page.locator('link[rel="canonical"]');
      await expect(canonical, `${path} declares no canonical`).toHaveCount(1);

      // `.href` resolves relative values, so this compares destinations rather
      // than the literal attribute — either form is valid to a crawler.
      const resolved = new URL(await canonical.evaluate((link) => (link as HTMLLinkElement).href));
      expect(resolved.pathname, `${path} points its canonical elsewhere`).toBe(path);
      expect(resolved.origin).toBe(new URL(baseURL ?? 'http://127.0.0.1:3200').origin);
    }
  });

  test('each public page has a title of its own', async ({ page }) => {
    const sitemap = await (await page.request.get('/sitemap.xml')).text();
    const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => new URL(match[1]).pathname,
    );

    const titles = new Map<string, string>();
    for (const path of paths) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      titles.set(path, await page.title());
    }

    // Inheriting the homepage title is the same defect seen from the other side.
    expect(new Set(titles.values()).size, `duplicate titles: ${[...titles].join(', ')}`).toBe(
      titles.size,
    );
  });

  /**
   * The unit tests build the graphs; this proves they survive the round trip
   * through `JSON.stringify` and the `<` escaping into the served HTML, which is
   * the only form a crawler ever sees.
   */
  test('every page in the sitemap serves parseable structured data', async ({ page }) => {
    const sitemap = await (await page.request.get('/sitemap.xml')).text();
    const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => new URL(match[1]).pathname,
    );

    for (const path of paths) {
      const html = await (await page.request.get(path)).text();
      const blocks = [
        ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
      ];
      expect(blocks.length, `${path} serves no JSON-LD`).toBeGreaterThan(0);

      for (const [, payload] of blocks) {
        const parsed = JSON.parse(payload.replace(/\\u003c/g, '<'));
        expect(parsed['@context']).toBe('https://schema.org');
        expect(Array.isArray(parsed['@graph'])).toBe(true);
      }
    }
  });

  test('the home page describes the product, the organization and the FAQ', async ({ page }) => {
    const html = await (await page.request.get('/')).text();
    const payload =
      html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? '';
    const types = JSON.parse(payload.replace(/\\u003c/g, '<'))['@graph'].map(
      (node: { '@type': string }) => node['@type'],
    );

    for (const expected of ['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage']) {
      expect(types, `home page graph is missing ${expected}`).toContain(expected);
    }
  });

  /**
   * A page that declares its own `openGraph` replaces the parent's whole object,
   * dropping the image `app/opengraph-image.tsx` had supplied. /mcp shipped that
   * way and rendered as a bare text card wherever it was linked — which is the
   * one page the MCP directory submissions point at.
   */
  test('every page in the sitemap has a share image that actually loads', async ({ page }) => {
    const sitemap = await (await page.request.get('/sitemap.xml')).text();
    const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => new URL(match[1]).pathname,
    );

    for (const path of paths) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      const ogImage = await page
        .locator('meta[property="og:image"]')
        .first()
        .getAttribute('content');
      expect(ogImage, `${path} has no og:image`).toBeTruthy();

      const twitterImage = await page
        .locator('meta[name="twitter:image"]')
        .first()
        .getAttribute('content');
      expect(twitterImage, `${path} has no twitter:image`).toBeTruthy();

      // A declared image that 404s is worse than none: the crawler caches the miss.
      const response = await page.request.get(ogImage as string);
      expect(response.status(), `${path} og:image does not load`).toBe(200);
      expect(response.headers()['content-type']).toContain('image/');
    }
  });
});
