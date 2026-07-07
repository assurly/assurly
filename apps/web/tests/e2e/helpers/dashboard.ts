import type { BrowserContext, Page, Route } from '@playwright/test';
import { expect } from '@playwright/test';
import {
  buildE2eSessionCookieValue,
  e2eAttestaRepo,
  e2eLeaksRepo,
  resolveE2eFindingsForScan,
  resolveE2eScansForRepo,
} from '../../../src/testing/e2eDashboardFixture';

const SESSION_COOKIE_NAME = 'assurly-session';

export async function installDashboardSession(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: buildE2eSessionCookieValue(),
      url: 'http://127.0.0.1:3200',
    },
  ]);
}

export async function mockDashboardScanApi(page: Page): Promise<void> {
  await page.route('**/api/scans**', async (route: Route) => {
    const requestUrl = new URL(route.request().url());
    const scanId = requestUrl.searchParams.get('scanId');
    const repoId = requestUrl.searchParams.get('repoId');

    if (scanId) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ findings: resolveE2eFindingsForScan(scanId) }),
      });
      return;
    }

    if (repoId) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ scans: resolveE2eScansForRepo(repoId) }),
      });
      return;
    }

    await route.fallback();
  });
}

export async function openAuthenticatedDashboard(page: Page): Promise<void> {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('repo-list-panel').waitFor({ state: 'visible' });
  await page.getByTestId('scan-details-ship-gate').waitFor({ state: 'visible' });
}

export async function waitForBlockedScanVerdict(page: Page): Promise<void> {
  await page.getByText('NOT READY TO SHIP').waitFor({ state: 'visible' });
}

export async function waitForRepoHeader(page: Page, repoName: string): Promise<void> {
  await page
    .locator('.dashboard-repo-heading')
    .filter({ hasText: repoName })
    .waitFor({ state: 'visible' });
}

/** Selected repo sticky header + jump CTA render only at <=992px. */
export const COMPACT_DASHBOARD_MAX_WIDTH = 992;

export async function assertJumpToScanDetails(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));

  const jumpButton = page.getByTestId('selected-repo-jump-btn');
  await expect(jumpButton).toBeVisible();
  await jumpButton.click();

  await expect
    .poll(
      async () =>
        page.getByTestId('scan-details-container').evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top >= 0 && rect.top <= window.innerHeight * 0.45;
        }),
      { timeout: 10_000 },
    )
    .toBe(true);
}

export const dashboardFixture = {
  attestaRepo: e2eAttestaRepo,
  leaksRepo: e2eLeaksRepo,
};
