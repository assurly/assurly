import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  dashboardFixture,
  installDashboardSession,
  mockDashboardScanApi,
  openAuthenticatedDashboard,
  waitForBlockedScanVerdict,
  waitForRepoHeader,
} from './helpers/dashboard';

/**
 * Step 5: a blocker shows the code behind it. The endpoint reads GitHub, so it
 * is mocked here with the shape it returns; what this pins is that the card
 * fetches only when opened, marks the finding line, and shows the fix as a diff.
 */

const ATTESTA_BLOCKED_SCAN = '22000000-0000-4000-8000-000000000003';
const COMMIT = 'b74c7bc0a5f1e2d3c4b5a6978877665544332211';
const FILE = 'db/migrations/003_create_auth_schema.up.sql';

const findingCode = {
  available: true,
  file: FILE,
  commitSha: COMMIT,
  githubUrl: `https://github.com/tibco87/Attesta/blob/${COMMIT}/${FILE}#L1`,
  window: {
    startLine: 1,
    lines: [
      'CREATE TABLE organizations (',
      '  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),',
      '  name text NOT NULL,',
      "  stripe_key text DEFAULT 'sk_live_••••••••',",
      '  created_at timestamptz NOT NULL DEFAULT now()',
      ');',
    ],
    highlightLine: 1,
    redactedCount: 1,
  },
  suggestedChange: {
    title: 'Enable RLS',
    description: 'Adds a migration that enables Row-Level Security.',
    file: 'db/migrations/99999999999999_assurly_enable_rls.sql',
    isNewFile: true,
    lines: [
      { kind: 'add', text: '-- Added by Assurly: enable Row-Level Security.', newLine: 1 },
      { kind: 'add', text: 'ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;', newLine: 2 },
    ],
  },
};

test.describe('Finding code preview', () => {
  test.beforeEach(async ({ context, page }) => {
    await installDashboardSession(context);
    await mockDashboardScanApi(page);
    await openAuthenticatedDashboard(page);
    await waitForRepoHeader(page, dashboardFixture.attestaRepo.name);
  });

  test('reads the code only when opened and shows the fix as a diff', async ({ page }) => {
    let requests = 0;
    await page.route('**/api/findings/*/code', async (route) => {
      requests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(findingCode),
      });
    });

    await waitForBlockedScanVerdict(page);
    await page.getByTestId(`scan-history-chip-${ATTESTA_BLOCKED_SCAN}`).click();
    await page.getByTestId('scan-findings-details-toggle').click();

    const card = page.getByTestId('scan-finding-card-finding-rls');
    await expect(card.getByText('Show the code')).toBeVisible();
    expect(requests).toBe(0);

    await card.getByText('Show the code').click();
    const hit = card.getByTestId('finding-code-line-1');
    await expect(hit).toHaveAttribute('aria-current', 'true');
    await expect(hit).toContainText('CREATE TABLE organizations');
    await expect(card.getByText('1 credential hidden.', { exact: false })).toBeVisible();
    await expect(card.getByText('What the fix changes')).toBeVisible();
    await expect(
      card.getByText('ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;'),
    ).toBeVisible();
    expect(requests).toBe(1);

    const results = await new AxeBuilder({ page })
      .include('[data-testid="scan-finding-card-finding-rls"]')
      .analyze();
    expect(results.violations).toEqual([]);

    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: test.info().outputPath('finding-code.png') });
  });

  test('stays inside the card at phone width', async ({ page }) => {
    await page.route('**/api/findings/*/code', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...findingCode,
          window: { ...findingCode.window, lines: [`SELECT ${'x, '.repeat(120)}1;`] },
        }),
      }),
    );
    await page.setViewportSize({ width: 375, height: 812 });
    await waitForBlockedScanVerdict(page);
    await page.getByTestId(`scan-history-chip-${ATTESTA_BLOCKED_SCAN}`).click();
    await page.getByTestId('scan-findings-details-toggle').click();
    const card = page.getByTestId('scan-finding-card-finding-rls');
    await card.getByText('Show the code').click();
    await expect(card.getByTestId('finding-code-line-1')).toBeVisible();

    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageOverflow).toBeLessThanOrEqual(0);
    // Long paths wrap inside the card; only the code block itself scrolls.
    const cardBox = await card.boundingBox();
    for (const text of [
      card.locator('.finding-code__file'),
      card.locator('.finding-code__change-file'),
    ]) {
      const box = await text.boundingBox();
      expect(box && cardBox && box.x + box.width <= cardBox.x + cardBox.width + 0.5).toBe(true);
    }
    await card.screenshot({ path: test.info().outputPath('finding-code-mobile.png') });
  });
});
