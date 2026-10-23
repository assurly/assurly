import { expect, test } from '@playwright/test';
import { installDashboardSession, mockDashboardClientApis } from './helpers/dashboard';

const TARGET_ID = '76cbe4db-d1a6-474f-b1c9-33bcebbc3f5e';

const CARD = {
  id: TARGET_ID,
  kind: 'url',
  identifier: 'https://assurly-live-target.vercel.app',
  displayName: 'assurly-live-target.vercel.app',
  repositoryId: null,
  generatorFingerprint: null,
  verdict: 'blocked',
  shipScore: 59,
  topIssue: null,
  lastCheckedAt: '2026-10-23T06:34:55.908Z',
  latestScanId: null,
  ownershipVerified: true,
  guardianEnabled: true,
  scoreDropped: false,
  badgeToken: null,
  scanCapability: 'browser',
  lastScanFailed: false,
  lastScanFailureReason: null,
  checkedCommitSha: null,
  headCommitSha: null,
};

const DETAIL = {
  id: TARGET_ID,
  identifier: CARD.identifier,
  displayName: CARD.displayName,
  verdict: 'blocked',
  shipScore: 59,
  lastCheckedAt: CARD.lastCheckedAt,
  ownershipVerified: true,
  blockers: [],
  otherEvidence: [],
  liveLock: {
    status: 'blocked',
    shipScore: 59,
    reason: 'runtime_blocker',
    gitSha: 'abc1234def',
    checkedAt: '2026-10-23T07:00:00.000Z',
    stoppedDeploy: true,
  },
};

async function showLiveLock(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/targets**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    if (path === `/api/targets/${TARGET_ID}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(DETAIL),
      });
      return;
    }
    if (path === '/api/targets') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ targets: [CARD] }),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Dashboard Live Lock', () => {
  test('opens the proof dialog on a narrow and a wide viewport', async ({ context, page }) => {
    await installDashboardSession(context);
    await mockDashboardClientApis(page);
    await showLiveLock(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await page
      .getByRole('button', { name: 'assurly-live-target.vercel.app: Not ready to ship' })
      .click();
    const panel = page.getByTestId('live-lock');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Live Lock stopped a deploy');
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(390);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('BLOCKED');
    const wide = await panel.boundingBox();
    expect(wide).not.toBeNull();
    expect(wide!.width).toBeGreaterThan(320);
    expect(wide!.x).toBeGreaterThanOrEqual(0);
  });
});
