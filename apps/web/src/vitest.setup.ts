/**
 * Global vitest setup – runs once per test file before any imports are evaluated.
 *
 * Root cause: Vite loads .env.local unconditionally (even when NODE_ENV=test),
 * so real credentials leak into process.env during the test run. This file
 * sanitizes the environment to a known safe baseline so individual tests never
 * accidentally depend on production or development secrets.
 *
 * Design contract:
 *   - Every test that NEEDS a value must stub or set it explicitly.
 *   - vi.unstubAllEnvs() will correctly restore stubs to `undefined` because
 *     the baseline here is already clean when vi.stubEnv first records the
 *     "original" value.
 */

import { afterEach } from 'vitest';

const CREDENTIALS_FROM_ENV_LOCAL = [
  // Stripe – live or test key, webhook secret, price IDs
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_MONTHLY',
  'STRIPE_PRICE_YEARLY',

  // Supabase – server-side secrets
  'SUPABASE_SERVICE_ROLE_KEY',

  // Email delivery
  'RESEND_API_KEY',

  // GitHub App private credentials
  'GITHUB_PRIVATE_KEY',
  'GITHUB_APP_ID',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_STATE_SECRET',

  // Rate-limiting HMAC key
  'RATE_LIMIT_SECRET',
] as const;

for (const key of CREDENTIALS_FROM_ENV_LOCAL) {
  delete process.env[key];
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}

/**
 * Testing Library unmounts after each test only when vitest globals are on,
 * and they are off here, so a file that never called cleanup() left its trees
 * mounted. A mounted next/link keeps a 1 ms timer (jsdom has no
 * IntersectionObserver); when the file's jsdom was torn down first, the
 * render it scheduled ran against a missing `window` and failed the whole run
 * with "ReferenceError: window is not defined" (privacy.test.tsx, 14 timers).
 * Node-environment files never load Testing Library.
 */
if (typeof window !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(cleanup);
}
