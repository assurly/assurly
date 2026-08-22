import type { BrowserContext, Page, Route } from '@playwright/test';
import { expect } from '@playwright/test';
import {
  buildE2eSessionCookieValue,
  e2eAttestaRepo,
  e2eLeaksRepo,
  resolveE2eFindingsForScan,
  resolveE2eScansForRepo,
  resolveE2eTrendPoints,
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

function jsonOk(body: unknown): { status: number; contentType: string; body: string } {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

/**
 * Client fetches that would 401 against real auth (the E2E fixture only seeds
 * the dashboard page session). A 401 here expires the in-app session.
 */
export async function mockDashboardClientApis(page: Page): Promise<void> {
  await page.route('**/api/targets/*/canary', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const path = new URL(route.request().url()).pathname.split('/');
    const targetsIndex = path.indexOf('targets');
    const targetId = targetsIndex >= 0 ? (path[targetsIndex + 1] ?? 'e2e-target') : 'e2e-target';
    await route.fulfill(jsonOk({ targetId, prefix: 'asrly_', tokens: [] }));
  });

  await page.route('**/api/targets', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill(jsonOk({ targets: [] }));
  });

  await page.route('**/api/api-keys', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill(jsonOk({ keys: [] }));
  });

  await page.route('**/api/repositories/*/trend', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.split('/');
    const repositoriesIndex = path.indexOf('repositories');
    const repositoryId = repositoriesIndex >= 0 ? (path[repositoriesIndex + 1] ?? '') : '';
    await route.fulfill(jsonOk({ points: resolveE2eTrendPoints(repositoryId) }));
  });
}

export async function mockDashboardScanApi(page: Page): Promise<void> {
  await mockDashboardClientApis(page);
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
  await mockDashboardClientApis(page);
  await page.goto(`/dashboard?view=app&repo=${e2eAttestaRepo.id}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: 'Apps', exact: true }).waitFor({ state: 'visible' });
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

  await expect(page.getByTestId('scan-details-container')).toBeInViewport({ timeout: 10_000 });
}

export const dashboardFixture = {
  attestaRepo: e2eAttestaRepo,
  leaksRepo: e2eLeaksRepo,
};
