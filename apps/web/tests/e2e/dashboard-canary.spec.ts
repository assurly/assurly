import { expect, test } from '@playwright/test';
import {
  dashboardFixture,
  installDashboardSession,
  mockDashboardScanApi,
} from './helpers/dashboard';

const TARGET_ID = '33000000-0000-4000-8000-000000000033';
const PLAINTEXT = `ask_canary_${'e'.repeat(32)}`;
const CALLBACK = `http://127.0.0.1:3200/api/canary/${PLAINTEXT}`;
const SNIPPET = [
  '# Assurly silent alarm — tripwire only. Do not copy into production .env as a real service URL.',
  '# If this URL is fetched, Assurly alerts you. Rotate real Stripe, Supabase, and GitHub secrets — not this value.',
  `${'ASSURLY_CANARY_URL'}=${CALLBACK}`,
].join('\n');
const MCP_SNIPPET = [
  '// Do not enable this server in Cursor. Add "assurly-cloud-auth" to disabledMcpjsonServers so your own agent does not trip the alarm.',
  JSON.stringify({ mcpServers: { 'assurly-cloud-auth': { url: CALLBACK } } }, null, 2),
].join('\n');
const PR_URL = 'https://github.com/assurly/attesta/pull/42';

test.describe('Dashboard silent alarm', () => {
  test('opens a plant PR after a scan and Copy shows both snippets', async ({ context, page }) => {
    await installDashboardSession(context);
    await mockDashboardScanApi(page);

    await page.route('**/api/targets/*/canary/plant', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '44000000-0000-4000-8000-000000000044',
          label: 'Silent alarm',
          tokenPrefix: 'ask_canary_eeeeee',
          token: PLAINTEXT,
          callbackUrl: CALLBACK,
          snippet: SNIPPET,
          mcpSnippet: MCP_SNIPPET,
          plantHint: 'Paste the env lines into .env.example.',
          prUrl: PR_URL,
          alreadyPlanted: false,
          createdAt: '2026-08-18T00:00:00.000Z',
        }),
      });
    });

    await page.route('**/api/targets/*/canary', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: '44000000-0000-4000-8000-000000000044',
            label: 'Silent alarm',
            tokenPrefix: 'ask_canary_eeeeee',
            token: PLAINTEXT,
            callbackUrl: CALLBACK,
            snippet: SNIPPET,
            mcpSnippet: MCP_SNIPPET,
            plantHint: 'Paste the env lines into .env.example.',
            createdAt: '2026-08-18T00:00:00.000Z',
          }),
        });
        return;
      }
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          targetId: TARGET_ID,
          prefix: 'ask_canary_',
          tokens: [],
        }),
      });
    });

    await page.route('**/api/targets', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          targets: [
            {
              id: TARGET_ID,
              kind: 'repo',
              identifier: dashboardFixture.attestaRepo.name,
              displayName: dashboardFixture.attestaRepo.name,
              repositoryId: dashboardFixture.attestaRepo.id,
              generatorFingerprint: null,
              verdict: 'blocked',
              shipScore: 40,
              topIssue: null,
              lastCheckedAt: '2026-06-26T08:55:00.000Z',
              latestScanId: '22000000-0000-4000-8000-000000000003',
              ownershipVerified: true,
              guardianEnabled: true,
              scoreDropped: false,
              badgeToken: null,
              scanCapability: 'browser',
            },
          ],
        }),
      });
    });

    await page.goto(`/dashboard?view=app&repo=${dashboardFixture.attestaRepo.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('button', { name: 'Apps', exact: true }).waitFor({ state: 'visible' });
    await page.getByTestId('scan-details-ship-gate').waitFor({ state: 'visible' });

    const alarm = page.getByTestId('canary-silent-alarm');
    await expect(alarm).toBeVisible();

    const plantButton = alarm.getByRole('button', { name: 'Open plant PR' });
    const copyButton = alarm.getByRole('button', { name: 'Add a silent alarm' });
    if (await plantButton.isVisible()) {
      await plantButton.click();
      await expect(alarm.getByRole('link', { name: 'Open plant pull request' })).toHaveAttribute(
        'href',
        PR_URL,
      );
    } else {
      await expect(copyButton).toBeVisible();
      await copyButton.click();
    }

    await expect(alarm.getByRole('button', { name: 'Copy silent alarm snippet' })).toBeVisible();
    await expect(alarm).toContainText('ASSURLY_CANARY_URL=');
    await expect(alarm).toContainText('assurly-cloud-auth');
    await expect(alarm.getByText(/Armed · Never used/i)).toBeVisible();
  });
});
