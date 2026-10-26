import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ complete: vi.fn() }));

vi.mock('../../../../../utils/vercelSso', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../utils/vercelSso')>()),
  completeVercelSso: mocks.complete,
  createSupabaseSessionIssuer: () => vi.fn(),
}));
vi.mock('../../../../../utils/dbAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../utils/dbAdapter')>()),
  getAdminDbAdapter: () => ({}),
}));

import { GET } from './route';
import { SsoError } from '../../../../../utils/vercelSso';
import { resetRateLimitsForTests } from '../../../../../utils/rateLimit';

function open(query: string, cookie = '') {
  return GET(
    new Request(`https://assurly.dev/api/vercel/marketplace/sso?${query}`, {
      headers: cookie ? { cookie } : {},
    }),
  );
}

describe('GET /api/vercel/marketplace/sso', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    vi.stubEnv('APP_URL', 'https://assurly.dev');
    vi.stubEnv('VERCEL_INTEGRATION_CLIENT_ID', 'oac_test');
    vi.stubEnv('VERCEL_INTEGRATION_CLIENT_SECRET', 'secret');
    vi.stubEnv('VERCEL_INTEGRATION_SLUG', 'assurly');
    vi.stubEnv('VERCEL_TOKEN_KEY', Buffer.alloc(32, 1).toString('base64'));
    mocks.complete.mockResolvedValue({
      userId: 'u1',
      organizationId: 'org-vercel',
      session: {
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    });
  });

  it('signs in, sets the session cookie and opens the dashboard', async () => {
    const res = await open('mode=sso&code=abc&state=xyz&resource_id=r1');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://assurly.dev/dashboard');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('assurly-session=');
    expect(cookie).toContain('HttpOnly');
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'abc', state: 'xyz', resource_id: 'r1' }),
      expect.anything(),
    );
  });

  it('accepts context parameters Vercel adds later', async () => {
    const res = await open('code=abc&experimentation_item_id=e1&pr=x&check_id=chk_1&brand_new=1');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://assurly.dev/dashboard');
  });

  it('opens the contact form for a support request', async () => {
    const res = await open('code=abc&support=true');
    expect(res.headers.get('location')).toBe('https://assurly.dev/?subject=technical#contact');
  });

  it('explains a failure on the error page and sets no session', async () => {
    mocks.complete.mockRejectedValueOnce(new SsoError('email_unverified'));
    const res = await open('code=abc');
    expect(res.headers.get('location')).toBe(
      'https://assurly.dev/sso-error?reason=email_unverified',
    );
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('treats an unexpected error as a failed exchange, never a raw 500', async () => {
    mocks.complete.mockRejectedValueOnce(new Error('boom'));
    const res = await open('code=abc');
    expect(res.headers.get('location')).toBe(
      'https://assurly.dev/sso-error?reason=exchange_failed',
    );
  });

  it('is not available until the integration is configured', async () => {
    vi.stubEnv('VERCEL_INTEGRATION_CLIENT_ID', '');
    const res = await open('code=abc');
    expect(res.headers.get('location')).toBe('https://assurly.dev/sso-error?reason=not_configured');
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
