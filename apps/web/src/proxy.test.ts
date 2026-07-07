import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { proxy } from './proxy';

// Mock Supabase Client
const mockGetUser = vi.fn();
const mockExchangeCode = vi.fn();
const mockRefreshSession = vi.fn();

vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: vi.fn().mockImplementation(() => ({
      auth: {
        getUser: mockGetUser,
        exchangeCodeForSession: mockExchangeCode,
        refreshSession: mockRefreshSession,
      },
    })),
  };
});

// Mock next/server NextResponse.next() and response.cookies. NextResponse.redirect
// is intentionally left unmocked so the real redirect (with a working cookie jar)
// is exercised by the route-protection tests.
const mockCookieSet = vi.fn();
const mockNext = vi.spyOn(NextResponse, 'next').mockImplementation(() => {
  const response = new Response();
  Object.defineProperty(response, 'cookies', { value: { set: mockCookieSet } });
  return response as unknown as NextResponse;
});

const PUBLIC_PATH = '/';

const nowSec = (): number => Math.floor(Date.now() / 1000);

const encodeSession = (session: Record<string, unknown>): string =>
  encodeURIComponent(JSON.stringify(session));

describe('Proxy Middleware', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const mockNextRequest = (cookieValue?: string, path: string = PUBLIC_PATH): NextRequest => {
    const url = `http://localhost${path}`;
    const req = {
      url,
      nextUrl: new URL(url),
      headers: new Headers(),
      cookies: {
        get: vi.fn().mockReturnValue(cookieValue ? { value: cookieValue } : undefined),
      },
    } as unknown as NextRequest;
    return req;
  };

  const enableSupabase = (): void => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'mock-anon';
  };

  // ---------------------------------------------------------------------------
  // Content-Security-Policy
  // ---------------------------------------------------------------------------

  it('does nothing when SUPABASE_URL is not set', async () => {
    delete process.env.SUPABASE_URL;
    const req = mockNextRequest();
    const res = await proxy(req);
    expect(res).toBeDefined();
    expect(mockNext).toHaveBeenCalled();
  });

  it('adds a nonce-based CSP without allowing inline scripts', async () => {
    delete process.env.SUPABASE_URL;
    const response = await proxy(mockNextRequest());
    const policy = response.headers.get('content-security-policy');
    expect(policy).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it('uses a unique nonce on every request', async () => {
    delete process.env.SUPABASE_URL;
    const first = (await proxy(mockNextRequest())).headers.get('content-security-policy');
    const second = (await proxy(mockNextRequest())).headers.get('content-security-policy');
    const nonceOf = (policy: string | null): string | undefined =>
      policy?.match(/'nonce-([^']+)'/)?.[1];
    expect(nonceOf(first)).toBeTruthy();
    expect(nonceOf(second)).toBeTruthy();
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });

  // ---------------------------------------------------------------------------
  // Session refresh (public route — refresh is route-agnostic)
  // ---------------------------------------------------------------------------

  it('does nothing when session cookie is missing on a public route', async () => {
    enableSupabase();
    const res = await proxy(mockNextRequest(undefined, PUBLIC_PATH));
    expect(res).toBeDefined();
    expect(mockNext).toHaveBeenCalled();
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  it('does nothing when session cookie is not a valid Supabase session', async () => {
    enableSupabase();
    const mockSession = encodeSession({ userId: 'test-user-123', name: 'Tibor Dev' });
    const res = await proxy(mockNextRequest(mockSession, PUBLIC_PATH));
    expect(res).toBeDefined();
    expect(mockNext).toHaveBeenCalled();
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  it('does nothing when session is valid and not close to expiration', async () => {
    enableSupabase();
    const validSession = encodeSession({
      accessToken: 'valid-jwt',
      refreshToken: 'valid-refresh-token',
      expiresAt: nowSec() + 1000,
    });
    const res = await proxy(mockNextRequest(validSession, PUBLIC_PATH));
    expect(res).toBeDefined();
    expect(mockNext).toHaveBeenCalled();
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  it('refreshes the session when token is close to expiration', async () => {
    enableSupabase();
    mockRefreshSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        },
      },
      error: null,
    });

    const expiringSession = encodeSession({
      accessToken: 'old-jwt',
      refreshToken: 'old-refresh-token',
      expiresAt: nowSec() + 30,
    });

    const res = await proxy(mockNextRequest(expiringSession, PUBLIC_PATH));

    expect(res).toBeDefined();
    expect(mockRefreshSession).toHaveBeenCalledWith({ refresh_token: 'old-refresh-token' });
    expect(mockCookieSet).toHaveBeenCalled();

    const setArgs = mockCookieSet.mock.calls[0];
    expect(setArgs[0]).toBe('assurly-session');
    const parsedCookie = JSON.parse(decodeURIComponent(setArgs[1]));
    expect(parsedCookie.accessToken).toBe('new-access-token');
    expect(parsedCookie.refreshToken).toBe('new-refresh-token');
  });

  it('fails silently and logs error when session refresh fails on a public route', async () => {
    enableSupabase();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockRefreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('Failed to refresh'),
    });

    const expiringSession = encodeSession({
      accessToken: 'old-jwt',
      refreshToken: 'old-refresh-token',
      expiresAt: nowSec() + 30,
    });

    const res = await proxy(mockNextRequest(expiringSession, PUBLIC_PATH));

    expect(res).toBeDefined();
    expect(mockRefreshSession).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('does not refresh until the token is within the (small) refresh threshold', async () => {
    enableSupabase();
    const comfortable = encodeSession({
      accessToken: 'jwt',
      refreshToken: 'refresh',
      expiresAt: nowSec() + 120, // outside the 60s threshold
    });
    const res = await proxy(mockNextRequest(comfortable, PUBLIC_PATH));
    expect(res).toBeDefined();
    expect(mockNext).toHaveBeenCalled();
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  it('treats refresh_token_already_used as a concurrent rotation, not an auth failure', async () => {
    enableSupabase();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // A sibling request already rotated the token: Supabase reports it as used.
    mockRefreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: { code: 'refresh_token_already_used', message: 'Invalid Refresh Token: Already Used' },
    });

    const expiringSession = encodeSession({
      accessToken: 'old-jwt',
      refreshToken: 'contended-refresh-token',
      expiresAt: nowSec() + 30,
    });

    const res = await proxy(mockNextRequest(expiringSession, PUBLIC_PATH));

    // The session must survive: no cookie clear, no crash, request proceeds.
    expect(mockRefreshSession).toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalled();
    expect(res.headers.get('content-security-policy')).toBeTruthy();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

describe('Proxy route protection (/dashboard)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const makeRequest = (cookieValue: string | undefined, path: string): NextRequest => {
    const url = `http://localhost${path}`;
    return {
      url,
      nextUrl: new URL(url),
      headers: new Headers(),
      cookies: {
        get: vi.fn().mockReturnValue(cookieValue ? { value: cookieValue } : undefined),
      },
    } as unknown as NextRequest;
  };

  const expectRedirectToHome = (res: NextResponse): void => {
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toBe('http://localhost/');
    // The proxy must not server-render protected pages for anonymous visitors.
    expect(mockNext).not.toHaveBeenCalled();
  };

  it('redirects anonymous requests (no cookie) away from /dashboard', async () => {
    const res = await proxy(makeRequest(undefined, '/dashboard'));
    expectRedirectToHome(res);
  });

  it('allows anonymous /dashboard during local PERF_BASELINE runs on localhost', async () => {
    process.env.PERF_BASELINE = '1';
    const res = await proxy(makeRequest(undefined, '/dashboard'));
    expect(res.status).toBe(200);
    expect(mockNext).toHaveBeenCalled();
  });

  it('redirects requests to nested protected paths (/dashboard/settings)', async () => {
    const res = await proxy(makeRequest(undefined, '/dashboard/settings'));
    expectRedirectToHome(res);
  });

  it('clears the session cookie when redirecting an anonymous request', async () => {
    const res = await proxy(makeRequest(undefined, '/dashboard'));
    const cookie = res.cookies.get('assurly-session');
    expect(cookie?.value).toBe('');
    expect(cookie?.maxAge).toBe(0);
  });

  it('redirects when the session cookie is malformed JSON (no SSR)', async () => {
    const res = await proxy(makeRequest('%7Bnot-json', '/dashboard'));
    expectRedirectToHome(res);
  });

  it('redirects when the cookie has no access token (forged/incomplete session)', async () => {
    const forged = encodeURIComponent(JSON.stringify({ userId: 'attacker', role: 'admin' }));
    const res = await proxy(makeRequest(forged, '/dashboard'));
    expectRedirectToHome(res);
  });

  it('redirects when the access token is present but empty', async () => {
    const empty = encodeURIComponent(JSON.stringify({ accessToken: '' }));
    const res = await proxy(makeRequest(empty, '/dashboard'));
    expectRedirectToHome(res);
  });

  it('does not call Supabase for anonymous protected requests (no work before redirect)', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'mock-anon';
    await proxy(makeRequest(undefined, '/dashboard'));
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  it('allows a structurally valid session through to /dashboard (real check happens in page)', async () => {
    const valid = encodeURIComponent(
      JSON.stringify({
        accessToken: 'valid-jwt',
        refreshToken: 'valid-refresh',
        expiresAt: Math.floor(Date.now() / 1000) + 1000,
      }),
    );
    const res = await proxy(makeRequest(valid, '/dashboard'));
    expect(mockNext).toHaveBeenCalled();
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('allows a session with only an access token (matches server readAccessToken contract)', async () => {
    const minimal = encodeURIComponent(JSON.stringify({ accessToken: 'only-access' }));
    const res = await proxy(makeRequest(minimal, '/dashboard'));
    expect(mockNext).toHaveBeenCalled();
    expect(res.headers.get('content-security-policy')).toBeTruthy();
  });

  it('does NOT protect public routes — anonymous users reach the landing page', async () => {
    const res = await proxy(makeRequest(undefined, '/'));
    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toBe(307);
  });

  it('does NOT redirect API routes (they enforce their own auth and need JSON, not HTML)', async () => {
    const res = await proxy(makeRequest(undefined, '/api/scans'));
    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toBe(307);
  });

  it('fails closed: expired session that cannot be refreshed is redirected from /dashboard', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'mock-anon';
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockRefreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('refresh token revoked'),
    });

    const expired = encodeURIComponent(
      JSON.stringify({
        accessToken: 'dead-jwt',
        refreshToken: 'revoked-refresh',
        expiresAt: Math.floor(Date.now() / 1000) - 10, // already expired
      }),
    );

    const res = await proxy(makeRequest(expired, '/dashboard'));

    expect(mockRefreshSession).toHaveBeenCalledWith({ refresh_token: 'revoked-refresh' });
    expectRedirectToHome(res);

    consoleErrorSpy.mockRestore();
  });

  it('refreshes and allows an expiring session on /dashboard without redirecting', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'mock-anon';

    mockRefreshSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'fresh-access',
          refresh_token: 'fresh-refresh',
          expires_in: 3600,
        },
      },
      error: null,
    });

    const expiring = encodeURIComponent(
      JSON.stringify({
        accessToken: 'old-jwt',
        refreshToken: 'old-refresh',
        expiresAt: Math.floor(Date.now() / 1000) + 30,
      }),
    );

    const res = await proxy(makeRequest(expiring, '/dashboard'));

    expect(mockRefreshSession).toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toBe(307);
    expect(mockCookieSet).toHaveBeenCalled();
  });

  it('does not crash and still redirects when refresh throws for an expired protected session', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'mock-anon';
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockRefreshSession.mockRejectedValueOnce(new Error('network down'));

    const expired = encodeURIComponent(
      JSON.stringify({
        accessToken: 'dead-jwt',
        refreshToken: 'some-refresh',
        expiresAt: Math.floor(Date.now() / 1000) - 5,
      }),
    );

    const res = await proxy(makeRequest(expired, '/dashboard'));

    expect(consoleErrorSpy).toHaveBeenCalled();
    expectRedirectToHome(res);

    consoleErrorSpy.mockRestore();
  });
});
