import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: 'http://127.0.0.1:3200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3200',
    url: 'http://127.0.0.1:3200',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      E2E_DASHBOARD_FIXTURE: '1',
      // The app requires APP_URL to boot (getApplicationUrl throws otherwise).
      // Set it here so E2E is self-contained and runs in CI without a local
      // .env file — the dev server is served from 127.0.0.1:3200.
      APP_URL: 'http://127.0.0.1:3200',
    },
  },
});
