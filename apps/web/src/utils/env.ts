const REQUIRED_SUPABASE_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function getSupabaseConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new ConfigurationError(
      `Supabase is not configured. Missing ${REQUIRED_SUPABASE_ENV.filter((name) => !process.env[name]).join(', ') || 'required credentials'}.`,
    );
  }

  return { url: url.replace(/\/$/, ''), anonKey };
}

export function getSupabaseAdminConfig(): {
  url: string;
  serviceRoleKey: string;
} {
  const { url } = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new ConfigurationError(
      'SUPABASE_SERVICE_ROLE_KEY is required for trusted system operations.',
    );
  }

  return { url, serviceRoleKey };
}

export function assertProductionSupabaseConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;
  getSupabaseAdminConfig();
}

const REQUIRED_STRIPE_ENV = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_MONTHLY',
  'STRIPE_PRICE_YEARLY',
] as const;

export function assertStripeConfig(): void {
  const missing = REQUIRED_STRIPE_ENV.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new ConfigurationError(
      `Stripe is not configured. Missing: ${missing.join(', ')}. See .env.example for setup instructions.`,
    );
  }

  const secretKey = process.env.STRIPE_SECRET_KEY!.trim();
  if (secretKey.startsWith('sk_live_') && process.env.NODE_ENV !== 'production') {
    // Warn loudly but do not block – developer may intentionally test against live mode.
    console.warn(
      '[Assurly] WARNING: STRIPE_SECRET_KEY is a live key but NODE_ENV is not "production". ' +
        'Use a test key (sk_test_...) for local development.',
    );
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!.trim();
  if (
    webhookSecret === 'whsec_REPLACE_WITH_YOUR_WEBHOOK_SECRET' ||
    !webhookSecret.startsWith('whsec_')
  ) {
    throw new ConfigurationError(
      'STRIPE_WEBHOOK_SECRET is not set correctly. ' +
        'Run `stripe listen --forward-to localhost:3000/api/stripe/webhook` and paste the printed secret.',
    );
  }
}

/**
 * Startup gate for Stripe. Mirrors assertProductionSupabaseConfig: billing
 * credentials are only mandatory in production. In development and test the
 * server must boot with the unfilled placeholders from .env.example, so
 * Stripe validation is deferred to the billing endpoints that actually need it.
 */
export function assertProductionStripeConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;
  assertStripeConfig();
}

export function getResendApiKey(): string | undefined {
  const value = process.env.RESEND_API_KEY?.trim();
  return value || undefined;
}

export function getResendFromAddress(): string {
  const value = process.env.RESEND_FROM_EMAIL?.trim();
  return value || 'Assurly Alerts <onboarding@resend.dev>';
}

export function assertResendApiKey(): string {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    throw new ConfigurationError(
      'RESEND_API_KEY is required for email delivery. See .env.example for setup instructions.',
    );
  }
  return apiKey;
}

export function getApplicationUrl(): string {
  const value = process.env.APP_URL?.trim();
  if (!value) throw new ConfigurationError('APP_URL is required.');

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError('APP_URL must be a valid absolute URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ConfigurationError('APP_URL must use HTTP or HTTPS.');
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    const allowLocalPerfBaseline =
      process.env.PERF_BASELINE === '1' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
    if (!allowLocalPerfBaseline) {
      throw new ConfigurationError('APP_URL must use HTTPS in production.');
    }
  }
  return url.origin;
}

let cachedLocalDevHostnames: Set<string> | undefined;

/** Hostnames that belong to this machine (used to reject stale/wrong LAN IPs in dev). */
export function getLocalDevHostnames(): Set<string> {
  if (cachedLocalDevHostnames) return cachedLocalDevHostnames;

  const hostnames = new Set(['localhost', '127.0.0.1', '::1']);
  // Lazy import keeps this module edge-safe when pulled in via instrumentation.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os');
  for (const entries of Object.values(os.networkInterfaces())) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4') {
        hostnames.add(entry.address);
      }
    }
  }
  cachedLocalDevHostnames = hostnames;
  return cachedLocalDevHostnames;
}

/** Local/LAN origins allowed for OAuth callbacks and CSRF checks during development. */
export function isTrustedDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return getLocalDevHostnames().has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Returns the canonical app origin for redirects and OAuth callbacks.
 * In development, prefers the incoming request origin when it is a trusted
 * local/LAN host so session cookies match how the browser reached the app
 * (e.g. http://192.168.x.x:3000 vs http://localhost:3000).
 */
export function resolveApplicationUrl(requestUrl?: string): string {
  const configured = getApplicationUrl();
  if (process.env.NODE_ENV === 'production' || !requestUrl) return configured;

  try {
    const origin = new URL(requestUrl).origin;
    if (isTrustedDevOrigin(origin)) return origin;
  } catch {
    // Fall back to APP_URL when the request URL is malformed.
  }
  return configured;
}

/** Resolves the app origin from reverse-proxy or Host headers (SSR pages). */
export function resolveApplicationUrlFromHost(
  hostHeader: string | null,
  forwardedProto?: string | null,
): string {
  if (!hostHeader) return getApplicationUrl();
  const proto = forwardedProto ?? 'http';
  return resolveApplicationUrl(`${proto}://${hostHeader}`);
}

/** Resolves the app origin from an incoming HTTP request (route handlers). */
export function resolveApplicationUrlFromRequest(request: Request): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host) {
    const proto =
      request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
    return resolveApplicationUrlFromHost(host, proto);
  }
  return resolveApplicationUrl(request.url);
}
