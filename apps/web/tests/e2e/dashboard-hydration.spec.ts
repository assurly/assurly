import { expect, test } from '@playwright/test';
import {
  dashboardFixture,
  installDashboardSession,
  mockDashboardScanApi,
  openAuthenticatedDashboard,
  waitForRepoHeader,
} from './helpers/dashboard';
import { e2eAttestaTrendPoints } from '../../src/testing/e2eDashboardFixture';

/**
 * Hydration mismatches from ambient-locale date formatting only show up when
 * the browser locale differs from Node's default (en-US). Headless Chromium
 * defaults to en-US, so the rest of the suite cannot catch this class of bug.
 */
test.use({ locale: 'sk-SK', timezoneId: 'Europe/Bratislava' });

const HYDRATION_PATTERN = /hydrat|did not match|server rendered HTML/i;

test.describe('Dashboard hydration under sk-SK', () => {
  test('loads /dashboard without hydration console errors', async ({ page }) => {
    const hydrationIssues: string[] = [];

    page.on('console', (message) => {
      if (message.type() !== 'error' && message.type() !== 'warning') {
        return;
      }
      const text = message.text();
      if (HYDRATION_PATTERN.test(text)) {
        hydrationIssues.push(`[console.${message.type()}] ${text}`);
      }
    });

    page.on('pageerror', (error) => {
      const text = error.message;
      if (HYDRATION_PATTERN.test(text)) {
        hydrationIssues.push(`[pageerror] ${text}`);
      }
    });

    await installDashboardSession(page.context());
    await mockDashboardScanApi(page);
    // Keep the client re-fetch aligned with the SSR-seeded trend points so the
    // locale-sensitive label stays on screen after mount.
    await page.route('**/api/repositories/**/trend', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ points: e2eAttestaTrendPoints }),
      });
    });

    await openAuthenticatedDashboard(page);
    await waitForRepoHeader(page, dashboardFixture.attestaRepo.name);

    // Trend chart is SSR-seeded with fixture points, so locale-sensitive labels
    // are present during hydration (not only after a client fetch).
    await expect(page.getByRole('region', { name: 'Ship Score trend' })).toBeVisible();

    expect(hydrationIssues, `Hydration issues:\n${hydrationIssues.join('\n')}`).toEqual([]);

    // Pinned en-US label — under ambient sk-SK this would read "26. 6." instead.
    await expect(page.getByText(/Latest 42\/100 · Jun 26/)).toBeVisible();
  });
});
