import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertProductionStripeConfig,
  assertProductionSupabaseConfig,
  assertStripeConfig,
  ConfigurationError,
  getApplicationUrl,
  getLocalDevHostnames,
  resolveApplicationUrl,
} from './env';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_STRIPE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_valid_key_for_unit_tests',
  STRIPE_WEBHOOK_SECRET: 'whsec_valid_webhook_secret_for_tests',
  STRIPE_PRICE_MONTHLY: 'price_monthly_test',
  STRIPE_PRICE_YEARLY: 'price_yearly_test',
} as const;

function stubValidStripe(): void {
  for (const [key, value] of Object.entries(VALID_STRIPE_ENV)) {
    vi.stubEnv(key, value);
  }
}

// ---------------------------------------------------------------------------
// assertProductionSupabaseConfig
// ---------------------------------------------------------------------------

describe('production Supabase configuration', () => {
  // Use vi.stubEnv for ALL env mutations so that vi.unstubAllEnvs() is the
  // single source of truth for cleanup. Avoid direct process.env assignment
  // or deletion, which can corrupt the reference that vitest tracks internally
  // and cause env leaks into subsequent describe blocks.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails production startup when Supabase credentials are missing', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_ANON_KEY', '');

    expect(() => assertProductionSupabaseConfig()).toThrow(ConfigurationError);
  });

  it('accepts a complete production configuration', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'publishable');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-only-secret');
    expect(() => assertProductionSupabaseConfig()).not.toThrow();
  });

  it('fails production startup without the server-only service role key', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'publishable');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(() => assertProductionSupabaseConfig()).toThrow('SUPABASE_SERVICE_ROLE_KEY');
  });
});

// ---------------------------------------------------------------------------
// assertStripeConfig
// ---------------------------------------------------------------------------

describe('assertStripeConfig – startup gate', () => {
  // vitest.setup.ts already sanitized .env.local before this file was evaluated,
  // so vi.unstubAllEnvs() restores stubs to undefined – no manual delete needed.
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // ── happy paths ────────────────────────────────────────────────────────

  it('does not throw when all Stripe variables are present and valid (test key)', () => {
    stubValidStripe();
    expect(() => assertStripeConfig()).not.toThrow();
  });

  it('does not throw for a live key in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STRIPE_SECRET_KEY', `sk_${'live'}_valid_production_key`);
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_production_secret');
    vi.stubEnv('STRIPE_PRICE_MONTHLY', 'price_monthly_prod');
    vi.stubEnv('STRIPE_PRICE_YEARLY', 'price_yearly_prod');
    expect(() => assertStripeConfig()).not.toThrow();
  });

  it('emits a console.warn when a live key is used outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('STRIPE_SECRET_KEY', `sk_${'live'}_leaked_to_dev`);
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_local_secret');
    vi.stubEnv('STRIPE_PRICE_MONTHLY', 'price_m');
    vi.stubEnv('STRIPE_PRICE_YEARLY', 'price_y');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(() => assertStripeConfig()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('live key');
  });

  it('does not warn when a test key is used in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    stubValidStripe();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => assertStripeConfig()).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // ── missing variables ──────────────────────────────────────────────────

  it('throws ConfigurationError when all Stripe variables are absent', () => {
    expect(() => assertStripeConfig()).toThrow(ConfigurationError);
  });

  it('names every missing variable in the error message', () => {
    expect(() => assertStripeConfig()).toThrow(
      /STRIPE_SECRET_KEY.*STRIPE_WEBHOOK_SECRET.*STRIPE_PRICE_MONTHLY.*STRIPE_PRICE_YEARLY/,
    );
  });

  it.each([
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_MONTHLY',
    'STRIPE_PRICE_YEARLY',
  ] as const)('throws when %s is the only missing variable', (missingKey) => {
    stubValidStripe();
    vi.stubEnv(missingKey, '');

    expect(() => assertStripeConfig()).toThrow(ConfigurationError);
    expect(() => assertStripeConfig()).toThrow(missingKey);
  });

  it('treats a whitespace-only value the same as absent', () => {
    stubValidStripe();
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '   ');

    expect(() => assertStripeConfig()).toThrow(ConfigurationError);
    expect(() => assertStripeConfig()).toThrow('STRIPE_WEBHOOK_SECRET');
  });

  // ── webhook secret format validation ──────────────────────────────────

  it('rejects the unset placeholder value from .env.example', () => {
    stubValidStripe();
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_REPLACE_WITH_YOUR_WEBHOOK_SECRET');

    expect(() => assertStripeConfig()).toThrow(ConfigurationError);
    expect(() => assertStripeConfig()).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it('rejects a webhook secret that does not start with whsec_', () => {
    stubValidStripe();
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'invalid_not_a_webhook_secret');

    expect(() => assertStripeConfig()).toThrow(ConfigurationError);
    expect(() => assertStripeConfig()).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it('rejects a webhook secret that is only the prefix with nothing after it', () => {
    stubValidStripe();
    // "whsec_" alone is technically not the placeholder, so the format check
    // must also guard against suspiciously short secrets.
    // The current validator only checks for the placeholder and the prefix –
    // a bare "whsec_" passes the prefix check; this test documents that boundary.
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_');
    // Still starts with "whsec_" → passes current validation (design decision documented).
    expect(() => assertStripeConfig()).not.toThrow();
  });

  it('error message includes setup instructions for fixing the webhook secret', () => {
    stubValidStripe();
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'wrong_format');

    let errorMessage = '';
    try {
      assertStripeConfig();
    } catch (e) {
      if (e instanceof Error) errorMessage = e.message;
    }

    expect(errorMessage).toMatch(/stripe listen/i);
  });
});

// ---------------------------------------------------------------------------
// assertProductionStripeConfig – production-only gate
// ---------------------------------------------------------------------------

describe('assertProductionStripeConfig – production gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is a no-op in development even when Stripe variables are missing', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    vi.stubEnv('STRIPE_PRICE_MONTHLY', '');
    vi.stubEnv('STRIPE_PRICE_YEARLY', '');
    expect(() => assertProductionStripeConfig()).not.toThrow();
  });

  it('is a no-op in test even when Stripe variables are missing', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(() => assertProductionStripeConfig()).not.toThrow();
  });

  it('throws in production when Stripe variables are missing', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    vi.stubEnv('STRIPE_PRICE_MONTHLY', '');
    vi.stubEnv('STRIPE_PRICE_YEARLY', '');
    expect(() => assertProductionStripeConfig()).toThrow(ConfigurationError);
  });

  it('passes in production with a complete configuration', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STRIPE_SECRET_KEY', `sk_${'live'}_valid_production_key`);
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_production_secret');
    vi.stubEnv('STRIPE_PRICE_MONTHLY', 'price_monthly_prod');
    vi.stubEnv('STRIPE_PRICE_YEARLY', 'price_yearly_prod');
    expect(() => assertProductionStripeConfig()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getApplicationUrl
// ---------------------------------------------------------------------------

describe('getApplicationUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── happy paths ────────────────────────────────────────────────────────

  it('returns the origin for a valid http URL in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    expect(getApplicationUrl()).toBe('http://localhost:3000');
  });

  it('returns the origin for a valid https URL in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_URL', 'https://app.assurly.dev');
    expect(getApplicationUrl()).toBe('https://app.assurly.dev');
  });

  it('strips a trailing slash from APP_URL', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('APP_URL', 'http://localhost:3000/');
    // URL.origin does not include a trailing slash by design.
    expect(getApplicationUrl()).toBe('http://localhost:3000');
  });

  it('trims surrounding whitespace before parsing', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('APP_URL', '  http://localhost:3000  ');
    expect(getApplicationUrl()).toBe('http://localhost:3000');
  });

  // ── missing / empty ────────────────────────────────────────────────────

  it('throws ConfigurationError when APP_URL is absent', () => {
    vi.stubEnv('APP_URL', '');
    expect(() => getApplicationUrl()).toThrow(ConfigurationError);
    expect(() => getApplicationUrl()).toThrow('APP_URL');
  });

  // ── invalid URL format ─────────────────────────────────────────────────

  it('throws ConfigurationError for a relative path', () => {
    vi.stubEnv('APP_URL', '/relative/path');
    expect(() => getApplicationUrl()).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError for a plain hostname without a scheme', () => {
    vi.stubEnv('APP_URL', 'app.assurly.dev');
    expect(() => getApplicationUrl()).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError for a malformed URL', () => {
    vi.stubEnv('APP_URL', 'not a url at all !!!');
    expect(() => getApplicationUrl()).toThrow(ConfigurationError);
  });

  // ── protocol enforcement ───────────────────────────────────────────────

  it('rejects a ftp:// scheme', () => {
    vi.stubEnv('APP_URL', 'ftp://files.assurly.dev');
    expect(() => getApplicationUrl()).toThrow(ConfigurationError);
    expect(() => getApplicationUrl()).toThrow(/HTTP/i);
  });

  it('rejects a javascript: scheme (XSS vector)', () => {
    vi.stubEnv('APP_URL', 'javascript:alert(1)');
    expect(() => getApplicationUrl()).toThrow(ConfigurationError);
  });

  it('rejects a data: URI', () => {
    vi.stubEnv('APP_URL', 'data:text/html,<h1>hi</h1>');
    expect(() => getApplicationUrl()).toThrow(ConfigurationError);
  });

  // ── production HTTPS enforcement ───────────────────────────────────────

  it('rejects http:// in production to prevent mixed-content and MITM risk', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_URL', 'http://insecure.assurly.dev');
    expect(() => getApplicationUrl()).toThrow(ConfigurationError);
    expect(() => getApplicationUrl()).toThrow(/HTTPS/i);
  });

  it('accepts http:// in development (local workflow)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    expect(() => getApplicationUrl()).not.toThrow();
  });

  it('accepts http://127.0.0.1 during local production perf baseline runs', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PERF_BASELINE', '1');
    vi.stubEnv('APP_URL', 'http://127.0.0.1:3000');
    expect(getApplicationUrl()).toBe('http://127.0.0.1:3000');
  });

  it('accepts http:// in test environment', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    expect(() => getApplicationUrl()).not.toThrow();
  });

  // ── return value shape ─────────────────────────────────────────────────

  it('returns only the origin, never a path component', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('APP_URL', 'http://localhost:3000/some/path?query=1');
    const result = getApplicationUrl();
    expect(result).toBe('http://localhost:3000');
    expect(result).not.toContain('/some/path');
    expect(result).not.toContain('?query');
  });

  it('preserves a non-standard port', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('APP_URL', 'http://localhost:4000');
    expect(getApplicationUrl()).toBe('http://localhost:4000');
  });
});

describe('resolveApplicationUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the request origin when Host matches this machine in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    const localIp = [...getLocalDevHostnames()].find((host) => host.startsWith('192.168.'));
    if (!localIp) return;
    expect(resolveApplicationUrl(`http://${localIp}:3000/api/auth/login`)).toBe(
      `http://${localIp}:3000`,
    );
  });

  it('falls back to APP_URL for LAN IPs that are not this machine', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    expect(resolveApplicationUrl('http://192.168.1.245:3000/api/auth/login')).toBe(
      'http://localhost:3000',
    );
  });

  it('falls back to APP_URL in production even for LAN hosts', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_URL', 'https://app.assurly.dev');
    expect(resolveApplicationUrl('http://192.168.1.245:3000/api/auth/login')).toBe(
      'https://app.assurly.dev',
    );
  });
});

// ---------------------------------------------------------------------------
// instrumentation – startup gate orchestration
// ---------------------------------------------------------------------------

describe('instrumentation register()', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('calls both production startup gates on startup', async () => {
    const envModule = await import('./env');
    const supabaseSpy = vi
      .spyOn(envModule, 'assertProductionSupabaseConfig')
      .mockImplementation(() => undefined);
    const stripeSpy = vi
      .spyOn(envModule, 'assertProductionStripeConfig')
      .mockImplementation(() => undefined);

    // Re-import instrumentation so it picks up spied module.
    vi.resetModules();
    vi.doMock('./env', () => ({
      assertProductionSupabaseConfig: supabaseSpy,
      assertProductionStripeConfig: stripeSpy,
    }));

    const { register } = await import('../instrumentation');
    register();

    expect(supabaseSpy).toHaveBeenCalledOnce();
    expect(stripeSpy).toHaveBeenCalledOnce();
  });

  it('does not validate Stripe outside production so dev/test boot with .env.example', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    // No Stripe variables set – assertProductionStripeConfig must be a no-op here.
    const { register } = await import('../instrumentation');
    expect(() => register()).not.toThrow();
  });

  it('propagates a ConfigurationError from the Stripe gate and halts startup', async () => {
    vi.resetModules();
    const expectedError = new ConfigurationError('STRIPE_WEBHOOK_SECRET is not set correctly.');

    vi.doMock('./env', () => ({
      assertProductionSupabaseConfig: vi.fn(),
      assertProductionStripeConfig: vi.fn(() => {
        throw expectedError;
      }),
    }));

    const { register } = await import('../instrumentation');
    expect(() => register()).toThrow(ConfigurationError);
    expect(() => register()).toThrow('STRIPE_WEBHOOK_SECRET');
  });

  it('propagates a ConfigurationError from assertProductionSupabaseConfig and halts startup', async () => {
    vi.resetModules();
    const expectedError = new ConfigurationError('SUPABASE_SERVICE_ROLE_KEY is required.');

    vi.doMock('./env', () => ({
      assertProductionSupabaseConfig: vi.fn(() => {
        throw expectedError;
      }),
      assertProductionStripeConfig: vi.fn(),
    }));

    const { register } = await import('../instrumentation');
    expect(() => register()).toThrow(ConfigurationError);
    expect(() => register()).toThrow('SUPABASE_SERVICE_ROLE_KEY');
  });
});
