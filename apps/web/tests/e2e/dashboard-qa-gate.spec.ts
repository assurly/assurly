import { expect, test } from '@playwright/test';
import {
  assertJumpToScanDetails,
  COMPACT_DASHBOARD_MAX_WIDTH,
  dashboardFixture,
  installDashboardSession,
  mockDashboardScanApi,
  openAuthenticatedDashboard,
  waitForBlockedScanVerdict,
  waitForRepoHeader,
} from './helpers/dashboard';

const QA_VIEWPORTS = [
  { label: '375px mobile', width: 375, height: 812 },
  { label: '768px tablet', width: 768, height: 1024 },
  { label: '1280px desktop', width: 1280, height: 900 },
] as const;

for (const viewport of QA_VIEWPORTS) {
  test.describe(`Dashboard QA gate @ ${viewport.label}`, () => {
    test.describe.configure({ mode: 'serial' });

    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test.beforeEach(async ({ context, page }) => {
      await installDashboardSession(context);
      await mockDashboardScanApi(page);
      await openAuthenticatedDashboard(page);
      await waitForRepoHeader(page, dashboardFixture.attestaRepo.name);
    });

    test('renders without horizontal overflow and core landmarks', async ({ page }) => {
      const audit = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
        mainCount: document.querySelectorAll('main').length,
      }));

      expect(audit.overflow).toBe(false);
      expect(audit.mainCount).toBe(1);
      await expect(page.getByRole('button', { name: 'Back to Apps' })).toBeVisible();
      await expect(page.locator('.dashboard-repo-heading')).toBeVisible();
      await expect(page.getByTestId('scan-history-rail')).toBeVisible();

      if (viewport.width <= COMPACT_DASHBOARD_MAX_WIDTH) {
        await expect(page.getByTestId('selected-repo-header')).toBeVisible();
      }
    });

    test('switches repositories without stale Attesta copy', async ({ page }) => {
      await waitForBlockedScanVerdict(page);
      await page.getByRole('button', { name: /select repository react-client-leaks/i }).click();
      await waitForRepoHeader(page, dashboardFixture.leaksRepo.name);
      await expect(page.getByText(/organizations.*Row-Level Security/i)).toHaveCount(0);
      await expect(
        page.getByTestId('scan-details-ship-gate').getByText(/Possible API key exposed/i),
      ).toBeVisible();
    });

    test('supports scan history navigation and jump to results', async ({ page }) => {
      await waitForBlockedScanVerdict(page);

      // Fixture has four saved runs (three of the same commit plus deadbee).
      // History must keep every run, newest first, with date and time on the chip.
      await expect(page.getByRole('heading', { name: 'Scan history (4)' })).toBeVisible();
      const chips = page.locator('[data-testid^="scan-history-chip-"]');
      await expect(chips).toHaveCount(4);
      await expect(chips.nth(0)).toHaveAttribute(
        'data-testid',
        'scan-history-chip-22000000-0000-4000-8000-000000000003',
      );
      await expect(chips.nth(0)).toHaveText(/commit 669c039/);
      await expect(chips.nth(0)).toHaveText(/\d{4}/);
      await expect(chips.nth(0)).toHaveText(/\d{1,2}:\d{2}/);
      await expect(
        page.getByTestId('scan-history-chip-22000000-0000-4000-8000-000000000001'),
      ).toBeVisible();

      const rail = page.getByTestId('scan-history-rail').locator('.scan-history-rail');
      const metrics = await rail.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }));
      if (metrics.scrollWidth > metrics.clientWidth) {
        await rail.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
        });
      } else if (metrics.scrollHeight > metrics.clientHeight) {
        await rail.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
      }

      // Anchored: the chip's name starts with the commit, while the adjacent
      // delete button's name ("Delete the scan of commit deadbee…") also
      // contains it.
      await page.getByRole('button', { name: /^commit deadbee/i }).click();
      await expect(page.getByText(/deadbee/i).first()).toBeVisible();

      if (viewport.width <= COMPACT_DASHBOARD_MAX_WIDTH) {
        await assertJumpToScanDetails(page);
      }
    });

    test('does not use emoji in primary dashboard navigation chrome', async ({ page }) => {
      const emojiPattern = /[\u{1F300}-\u{1FAFF}]/u;
      const chromeText = (
        await page
          .locator(
            '.dashboard-header, .dashboard-tabs, .repo-list-panel, .selected-repo-header, .dashboard-workspace',
          )
          .allTextContents()
      ).join('\n');

      expect(emojiPattern.test(chromeText)).toBe(false);
    });
  });
}
