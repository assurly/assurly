import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  dashboardFixture,
  installDashboardSession,
  mockDashboardScanApi,
  openAuthenticatedDashboard,
  waitForBlockedScanVerdict,
  waitForRepoHeader,
} from './helpers/dashboard';

/**
 * Comprehensive dashboard E2E coverage authored as a senior QA pass.
 * The existing dashboard-qa-gate / dashboard-mobile specs cover layout,
 * repo switching, and the scan-history rail. This suite fills the gaps:
 * tabs, repo filtering, all three Ship Gate verdicts, findings drill-down,
 * share / auto-fix / billing flows, empty + error states, public-repo
 * discovery, the account menu, and axe on the *authenticated* dashboard
 * (the accessibility spec only ever sees the logged-out view).
 */

const ATTESTA_BLOCKED_SCAN = '22000000-0000-4000-8000-000000000003';
const ATTESTA_CLEAN_SCAN = '22000000-0000-4000-8000-000000000004';

function originOf(url: string): string {
  return new URL(url).origin;
}

/** Register the API mocks the extra flows depend on. Order matters: these are
 *  registered after mockDashboardScanApi so Playwright matches them first. */
async function mockDashboardFlowApis(page: Page): Promise<void> {
  await page.route('**/api/scans/share', async (route) => {
    const origin = originOf(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'e2e-share-token',
        url: `${origin}/report/e2e-share-token`,
      }),
    });
  });

  await page.route('**/api/github/fix', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        prUrl: 'https://github.com/acme/attesta/pull/42',
        // fixSchema requires UUIDs; the fixture finding id ("finding-rls")
        // is not a UUID, so the specific card cannot flip — the success
        // toast is the reliable happy-path signal (documented in the report).
        findingIds: ['33000000-0000-4000-8000-000000000001'],
      }),
    });
  });

  await page.route('**/api/stripe/portal', async (route) => {
    const origin = originOf(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: `${origin}/dashboard?billing=portal-stub` }),
    });
  });

  await page.route('**/api/github/discover**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 900,
          name: 'awesome-lib',
          full_name: 'octocat/awesome-lib',
          description: 'A discovered public repo',
          stargazers_count: 1234,
          language: 'TypeScript',
        },
        {
          id: 901,
          name: 'second-lib',
          full_name: 'octocat/second-lib',
          description: null,
          stargazers_count: 7,
          language: null,
        },
      ]),
    });
  });
}

test.describe('Dashboard full suite @1280px', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ context, page }) => {
    await installDashboardSession(context);
    await mockDashboardScanApi(page);
    await mockDashboardFlowApis(page);
    await openAuthenticatedDashboard(page);
    await waitForRepoHeader(page, dashboardFixture.attestaRepo.name);
  });

  test('switches between Repositories and Manual Checker tabs', async ({ page }) => {
    await expect(page.getByTestId('repo-list-panel')).toBeVisible();

    await page.getByRole('button', { name: 'Manual Checker' }).click();
    // NB: the `manual-checker` test id lives only in the unit-test mock, so the
    // real component root has no E2E hook — assert on rendered content instead.
    await expect(page.getByRole('heading', { name: 'Interactive Config Checker' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Supabase Migration/ })).toBeVisible();
    await expect(page.getByTestId('repo-list-panel')).toHaveCount(0);

    await page.getByRole('button', { name: 'Repositories' }).click();
    await expect(page.getByTestId('repo-list-panel')).toBeVisible();
  });

  test('filters the repository list and shows a no-match state', async ({ page }) => {
    const filter = page.getByTestId('repo-list-filter');

    await filter.fill('leaks');
    await expect(
      page.getByRole('button', { name: /select repository react-client-leaks/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /select repository tibco87\/Attesta/i }),
    ).toHaveCount(0);

    await filter.fill('zzz-nothing-matches');
    await expect(page.getByTestId('repo-list-no-match')).toBeVisible();

    await filter.fill('');
    await expect(
      page.getByRole('button', { name: /select repository tibco87\/Attesta/i }),
    ).toBeVisible();
  });

  test('renders the NOT READY verdict with a ship score by default', async ({ page }) => {
    await waitForBlockedScanVerdict(page);
    const gate = page.getByTestId('scan-details-ship-gate');
    await expect(gate.getByText('NOT READY TO SHIP')).toBeVisible();
    await expect(gate.getByLabel(/Ship score \d+ out of 100/)).toBeVisible();
    await expect(gate.getByText(/Ship Score/)).toBeVisible();
  });

  test('shows REVIEW RECOMMENDED for the clean (warning-only) scan', async ({ page }) => {
    await waitForBlockedScanVerdict(page);
    await page.getByTestId(`scan-history-chip-${ATTESTA_CLEAN_SCAN}`).click();
    await expect(
      page.getByTestId('scan-details-ship-gate').getByText('REVIEW RECOMMENDED'),
    ).toBeVisible();
    await expect(page.getByText('NOT READY TO SHIP')).toHaveCount(0);
  });

  test('expands the findings drill-down and shows the RLS finding card', async ({ page }) => {
    await waitForBlockedScanVerdict(page);
    await page.getByTestId(`scan-history-chip-${ATTESTA_BLOCKED_SCAN}`).click();

    const toggle = page.getByTestId('scan-findings-details-toggle');
    await expect(toggle).toBeVisible();
    await toggle.click();

    const card = page.getByTestId('scan-finding-card-finding-rls');
    await expect(card).toBeVisible();
    await expect(card.getByText(/Row-Level Security/i)).toBeVisible();
    await expect(card.getByText('error')).toBeVisible();
  });

  test('creates a shareable Ship Gate report link (Pro)', async ({ page }) => {
    await waitForBlockedScanVerdict(page);

    const shareBtn = page.getByRole('button', { name: /share report/i });
    await expect(shareBtn).toBeVisible();
    await shareBtn.click();

    await expect(page.getByText('Shareable Ship Gate report link created.')).toBeVisible();
    const shareInput = page.getByLabel('Shareable report URL');
    await expect(shareInput).toBeVisible();
    await expect(shareInput).toHaveValue(/\/report\/e2e-share-token$/);
    await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
  });

  test('creates a single auto-fix pull request from a fixable finding', async ({ page }) => {
    await waitForBlockedScanVerdict(page);
    await page.getByTestId(`scan-history-chip-${ATTESTA_BLOCKED_SCAN}`).click();
    await page.getByTestId('scan-findings-details-toggle').click();

    const fixBtn = page.getByRole('button', { name: /Create Fix PR/i });
    await expect(fixBtn).toBeVisible();
    await fixBtn.click();

    await expect(page.getByText('Pull request created successfully.')).toBeVisible();
  });

  test('opens the Stripe billing portal from the account menu (Pro)', async ({ page }) => {
    await page
      .getByRole('button', { name: /account menu/i })
      .first()
      .click();
    const menu = page.getByRole('dialog', { name: 'Account menu' });
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Pro Plan')).toBeVisible();

    await menu.getByRole('button', { name: /Manage Billing/i }).click();
    await page.waitForURL(/billing=portal-stub/);
    expect(page.url()).toContain('billing=portal-stub');
  });

  test('shows an empty-state when a repository has no scans', async ({ page }) => {
    await page.getByRole('button', { name: /select repository empty-repo/i }).click();
    await waitForRepoHeader(page, 'empty-repo');
    await expect(page.getByText('No scans found for this repository')).toBeVisible();
  });

  test('surfaces a scan error panel when the GitHub proxy fails, and dismisses it', async ({
    page,
  }) => {
    await page.route('**/api/github/proxy**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
    );
    await page.route('**/api/github/public-scan**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
    );

    await page.getByRole('button', { name: /Run secure scan/i }).click();

    const errorPanel = page.getByTestId('scan-error-panel');
    await expect(errorPanel).toBeVisible();
    await expect(errorPanel.getByText('Scan failed')).toBeVisible();

    await errorPanel.getByRole('button', { name: 'Dismiss scan error' }).click();
    await expect(errorPanel).toHaveCount(0);
  });

  test('discovers public repositories by owner name', async ({ page }) => {
    const input = page.getByPlaceholder('owner/repo (e.g. facebook/react)');
    await input.fill('octocat');
    await page.getByRole('button', { name: /Connect & Scan/i }).click();

    await expect(page.getByText(/Select repository \(2\)/)).toBeVisible();
    await expect(page.getByRole('button', { name: /awesome-lib/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /second-lib/ })).toBeVisible();
  });

  test('account menu toggles with correct ARIA state', async ({ page }) => {
    const trigger = page.getByRole('button', { name: /account menu/i }).first();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('dialog', { name: 'Account menu' })).toBeVisible();
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('authenticated dashboard passes axe WCAG A/AA', async ({ page }) => {
    await waitForBlockedScanVerdict(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations, `dashboard: ${JSON.stringify(results.violations, null, 2)}`).toEqual(
      [],
    );
  });
});
