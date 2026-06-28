import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Override real credentials from .env.local at the Vite config layer.
    //
    // Root cause: Vite injects .env.local into process.env in the worker process
    // BEFORE setupFiles run, so by the time any test code executes, live
    // credentials are already present. Setting them to '' here establishes
    // an empty string baseline that:
    //   1. passes `?.trim()` checks as "absent" in all env validators,
    //   2. becomes the "original" value that vi.unstubAllEnvs() restores to,
    //   3. keeps the production secrets out of the test process entirely.
    //
    // Any test that needs a specific value must stub or set it explicitly.
    env: {
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      STRIPE_PRICE_MONTHLY: '',
      STRIPE_PRICE_YEARLY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      RESEND_API_KEY: '',
      GITHUB_APP_ID: '',
      GITHUB_PRIVATE_KEY: '',
      GITHUB_WEBHOOK_SECRET: '',
      GITHUB_STATE_SECRET: '',
      RATE_LIMIT_SECRET: '',
    },

    // Runs once per test file in the worker, after env overrides are applied.
    // Provides an additional safety layer using process.env deletion so that
    // vi.stubEnv records undefined (not '') as the original value for Stripe vars,
    // making vi.unstubAllEnvs() restore to a fully absent state.
    setupFiles: ['./src/vitest.setup.ts'],
  },
});
