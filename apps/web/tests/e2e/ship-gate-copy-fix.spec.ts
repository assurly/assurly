import { expect, test } from '@playwright/test';
import {
  dashboardFixture,
  installDashboardSession,
  mockDashboardScanApi,
  openAuthenticatedDashboard,
  waitForBlockedScanVerdict,
  waitForRepoHeader,
} from './helpers/dashboard';

// The default Attesta scan is a blocked RLS finding, which renders a Ship Gate
// "hint" action ("Enable row-level security") — the surface the copy button was
// added to. This exercises the real dashboard render, not just the unit.
// The button is located by its stable class (the accessible name flips to
// "Copied!" on click, so a name-based locator would stop matching).
const HINT_COPY_BUTTON = '.ship-gate-list-action--hint .ship-gate-action-copy';

test.describe('Ship Gate copy-fix button @1280px', () => {
  test.use({
    viewport: { width: 1280, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  test.beforeEach(async ({ context, page }) => {
    await installDashboardSession(context);
    await mockDashboardScanApi(page);
    await openAuthenticatedDashboard(page);
    await waitForRepoHeader(page, dashboardFixture.attestaRepo.name);
    await waitForBlockedScanVerdict(page);
  });

  test('copies the suggestion and confirms with a Copied state', async ({ page }) => {
    const copyButton = page.locator(HINT_COPY_BUTTON).first();
    await expect(copyButton).toBeVisible();
    await expect(copyButton).toContainText('Copy fix');

    await copyButton.click();

    // The button confirms the copy in place.
    await expect(copyButton).toHaveClass(/ship-gate-action-copy--copied/);
    await expect(copyButton).toContainText(/copied/i);

    // The clipboard actually received the suggestion text.
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard.trim().length).toBeGreaterThan(0);
  });

  test('the copy button does not cause horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator(HINT_COPY_BUTTON).first()).toBeVisible();
    const scrollsSideways = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(scrollsSideways).toBe(false);
  });
});
