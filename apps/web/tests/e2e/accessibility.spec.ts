import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const routes = ['/', '/dashboard', '/privacy', '/terms', '/mcp'] as const;
const widths = [320, 390, 768, 1024, 1440] as const;

const targetSelector = [
  'button',
  '[role="button"]',
  '[role="tab"]',
  'select',
  'input:not([type="hidden"])',
  'textarea',
  'a.btn',
  'header nav a',
  '.back-link',
].join(',');

async function openRoute(page: Page, route: (typeof routes)[number]): Promise<void> {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
}

for (const width of widths) {
  test.describe(`${width}px viewport`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const route of routes) {
      test(`${route} has no overflow, unnamed form controls, or undersized touch targets`, async ({
        page,
      }) => {
        await openRoute(page, route);

        const audit = await page.evaluate((selector) => {
          const isVisible = (element: Element): boolean => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              rect.width > 0 &&
              rect.height > 0
            );
          };

          const unnamedControls = Array.from(
            document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
              'input:not([type="hidden"]), select, textarea',
            ),
          )
            .filter(isVisible)
            .filter(
              (element) =>
                !element.getAttribute('aria-label') &&
                !element.getAttribute('aria-labelledby') &&
                !(element.id && document.querySelector(`label[for="${element.id}"]`)),
            )
            .map((element) => `${element.tagName.toLowerCase()}#${element.id}`);

          const smallTargets = Array.from(document.querySelectorAll<HTMLElement>(selector))
            .filter(isVisible)
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return rect.width < 43.5 || rect.height < 43.5;
            })
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return `${element.tagName.toLowerCase()}.${element.className}:${Math.round(rect.width)}x${Math.round(rect.height)}`;
            });

          return {
            overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
            unnamedControls,
            smallTargets,
          };
        }, targetSelector);

        expect(audit).toEqual({ overflow: false, unnamedControls: [], smallTargets: [] });
      });
    }
  });
}

test('mobile pricing and checkout choices are a single column', async ({ page }) => {
  for (const width of [320, 390, 768] as const) {
    await page.setViewportSize({ width, height: 900 });
    await openRoute(page, '/');
    await expect(page.locator('.pricing-grid')).toHaveCSS('grid-template-columns', /^(?!.* ).+$/);
    await expect(page.locator('.pricing-controls-container')).toHaveCSS('flex-direction', 'column');
  }
});

test('mobile menu traps focus, closes with Escape, and returns focus', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openRoute(page, '/');

  const trigger = page.locator('.hamburger-btn');
  await expect(trigger).toHaveAccessibleName('Open navigation');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('link', { name: 'Features' })).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#primary-navigation a[href$="/api/auth/login"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
});

test('mobile menu closes when tapping outside the drawer', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openRoute(page, '/');

  const trigger = page.locator('.hamburger-btn');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  const navBox = await page.locator('#primary-navigation').boundingBox();
  expect(navBox).not.toBeNull();
  if (!navBox) return;

  await page.mouse.click(navBox.x + navBox.width / 2, navBox.y + navBox.height - 24);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('WCAG A/AA automated rules pass on every route', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  for (const route of routes) {
    await openRoute(page, route);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations, `${route}: ${JSON.stringify(results.violations)}`).toEqual([]);
  }
});

test('reduced motion disables meaningful animation and transition durations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openRoute(page, '/');

  const movingElements = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const durations = `${style.animationDuration},${style.transitionDuration}`
          .split(',')
          .map(
            (value) =>
              Number(value.trim().replace('ms', '')) ||
              Number(value.trim().replace('s', '')) * 1000,
          );
        return durations.some((duration) => duration > 0.02);
      })
      .slice(0, 20)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
  );

  expect(movingElements).toEqual([]);
});
