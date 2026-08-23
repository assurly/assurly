import { expect, test } from '@playwright/test';
import {
  assertJumpToScanDetails,
  dashboardFixture,
  installDashboardSession,
  mockDashboardScanApi,
  openAuthenticatedDashboard,
  waitForBlockedScanVerdict,
  waitForRepoHeader,
} from './helpers/dashboard';

test.describe('Dashboard mobile flows @375px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(async ({ context, page }) => {
    await installDashboardSession(context);
    await mockDashboardScanApi(page);
    await openAuthenticatedDashboard(page);
    await waitForRepoHeader(page, dashboardFixture.attestaRepo.name);
  });

  test('switches repositories without leaving stale Attesta results visible', async ({ page }) => {
    await waitForBlockedScanVerdict(page);

    await page.getByRole('button', { name: /select repository react-client-leaks/i }).click();

    await waitForRepoHeader(page, dashboardFixture.leaksRepo.name);
    await expect(page.getByText('NOT READY TO SHIP')).toBeVisible();
    await expect(page.getByText(/organizations.*Row-Level Security/i)).toHaveCount(0);
    await expect(
      page.getByTestId('scan-details-ship-gate').getByText(/Possible API key exposed/i),
    ).toBeVisible();
  });

  test('scrolls the scan history rail horizontally on mobile', async ({ page }) => {
    const rail = page.getByTestId('scan-history-rail').locator('.scan-history-rail');
    await expect(rail).toBeVisible();

    const beforeScroll = await rail.evaluate((element) => ({
      scrollLeft: element.scrollLeft,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(beforeScroll.scrollWidth).toBeGreaterThan(beforeScroll.clientWidth);

    await rail.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });

    await expect
      .poll(async () => rail.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(beforeScroll.scrollLeft);

    await expect(
      page.getByTestId('scan-history-chip-22000000-0000-4000-8000-000000000004'),
    ).toBeVisible();
  });

  test('keeps scan text fields at 16px so iOS Safari will not zoom on focus', async ({ page }) => {
    await page.getByRole('button', { name: /back to apps/i }).click();
    const urlInput = page.locator('#dashboard-deployed-url');
    await expect(urlInput).toBeAttached();
    await expect
      .poll(async () => urlInput.evaluate((element) => getComputedStyle(element).fontSize))
      .toBe('16px');

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });

  test('jumps to the scan details container from the repo header', async ({ page }) => {
    await page.getByTestId('scan-details-container').waitFor({ state: 'attached' });
    await assertJumpToScanDetails(page);
  });
});
