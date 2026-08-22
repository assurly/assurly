import { expect, test, type Page, type Route } from '@playwright/test';
import {
  dashboardFixture,
  installDashboardSession,
  mockDashboardScanApi,
  openAuthenticatedDashboard,
} from './helpers/dashboard';

const READY_SHIP_GATE = {
  status: 'ready',
  shipScore: 100,
  headline: 'READY TO SHIP',
  statusEmoji: '✅',
  blockers: [],
  reviews: [],
  warnings: [],
  cleanFileCount: 1,
  scannedFileCount: 1,
  totalErrorFindings: 0,
  totalWarningFindings: 0,
};

const FULL_VISIBILITY = {
  score: 58,
  aiReadinessScore: 50,
  searchReadinessScore: 66,
  verdict: 'partial' as const,
  checks: [
    {
      id: 'ai-llms-txt',
      title: 'llms.txt is published',
      group: 'ai' as const,
      status: 'fail' as const,
      detail: 'llms.txt is absent or empty.',
      fix: 'Serve /llms.txt with a clear site summary.',
    },
    {
      id: 'seo-title',
      title: 'Document title is set',
      group: 'search' as const,
      status: 'pass' as const,
      detail: '<title> is 42 characters.',
    },
  ],
};

async function mockScanUrl(page: Page, body: Record<string, unknown>): Promise<void> {
  await page.route('**/api/scan-url', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function runUrlScan(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  const urlInput = page.getByLabel('Deployed application URL');
  await urlInput.fill('https://myapp.example.com');
  await page.getByRole('button', { name: 'Scan URL' }).click();
  await page.getByTestId('visibility-audit').waitFor({ state: 'visible', timeout: 15_000 });
}

async function openAttestaShipGate(page: Page): Promise<void> {
  await page.goto(`/dashboard?view=app&repo=${dashboardFixture.attestaRepo.id}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByTestId('scan-details-ship-gate').waitFor({ state: 'visible' });
}

test.describe('SEO & GEO Audit panel', () => {
  test.beforeEach(async ({ context, page }) => {
    await installDashboardSession(context);
    await mockDashboardScanApi(page);
  });

  test('panel appears after a URL scan with score and verdict; Ship Gate is unaffected', async ({
    page,
  }) => {
    await mockScanUrl(page, {
      report: READY_SHIP_GATE,
      findings: [],
      evidence: [],
      target: { id: 't1', ownershipVerified: false },
      visibility: FULL_VISIBILITY,
    });

    await openAuthenticatedDashboard(page);
    await runUrlScan(page);

    const panel = page.getByTestId('visibility-audit');
    await expect(panel.getByRole('heading', { name: /SEO & GEO Audit/i })).toBeVisible();
    await expect(page.getByTestId('visibility-audit-verdict')).toContainText('PARTIALLY VISIBLE');
    await expect(page.getByTestId('visibility-audit-score')).toContainText('58/100');
    await expect(page.getByTestId('visibility-audit-checks')).toBeVisible();
    await expect(page.getByText('llms.txt is published')).toBeVisible();

    // URL scan has its own Ship Gate on Overview. The Attesta repo verdict must stay blocked.
    await expect(page.getByText('READY TO SHIP').first()).toBeVisible();
    await expect(page.getByLabel('Ship Gate readiness summary')).toBeVisible();
    await openAttestaShipGate(page);
    await expect(
      page.getByTestId('scan-details-ship-gate').getByText('NOT READY TO SHIP'),
    ).toBeVisible();
  });

  test('locked state shows the headline and not the checks', async ({ page }) => {
    await mockScanUrl(page, {
      report: READY_SHIP_GATE,
      findings: [],
      evidence: [],
      target: { id: 't1', ownershipVerified: false },
      visibility: {
        score: 58,
        aiReadinessScore: 50,
        searchReadinessScore: 66,
        verdict: 'partial',
      },
      visibilityLocked: true,
    });

    await openAuthenticatedDashboard(page);
    await runUrlScan(page);

    await expect(page.getByTestId('visibility-audit-verdict')).toContainText('PARTIALLY VISIBLE');
    await expect(page.getByTestId('visibility-audit-score')).toContainText('58/100');
    await expect(page.getByTestId('visibility-audit-checks')).toHaveCount(0);
    await expect(page.getByTestId('visibility-audit-locked-hint')).toBeVisible();
    await expect(page.getByText('llms.txt is published')).toHaveCount(0);

    await expect(page.getByText('READY TO SHIP').first()).toBeVisible();
    await openAttestaShipGate(page);
    await expect(
      page.getByTestId('scan-details-ship-gate').getByText('NOT READY TO SHIP'),
    ).toBeVisible();
  });
});
