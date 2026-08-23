import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDevHostnames } from '../../../utils/env';
import { GET as callbackGet } from './callback/route';
import { GET as loginGet } from './login/route';

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  signInWithOAuth: vi.fn(),
  getUserDbAdapter: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      signInWithOAuth: mocks.signInWithOAuth,
    },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: vi.fn() }),
}));
vi.mock('../../../utils/dbAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/dbAdapter')>()),
  getUserDbAdapter: mocks.getUserDbAdapter,
}));

describe('Supabase authentication routes', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.APP_URL = 'http://localhost';
    mocks.getUserDbAdapter.mockReturnValue({
      getOrganizationByUserId: vi.fn().mockResolvedValue({ id: 'org-a' }),
      createOrganization: vi.fn(),
    });
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('refuses login instead of creating a mock user when Supabase is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;

    const response = await loginGet(new Request('http://localhost/api/auth/login'));
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('starts GitHub PKCE with configured Supabase', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    mocks.signInWithOAuth.mockResolvedValue({
      data: { url: 'https://example.supabase.co/auth/authorize' },
      error: null,
    });

    const response = await loginGet(new Request('http://localhost/api/auth/login'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('example.supabase.co');
  });

  it('uses the request origin for OAuth redirect in development', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    mocks.signInWithOAuth.mockResolvedValue({
      data: { url: 'https://example.supabase.co/auth/authorize' },
      error: null,
    });

    const localIp = [...getLocalDevHostnames()].find((host) => host.startsWith('192.168.'));
    const host = localIp ? `${localIp}:3000` : 'localhost:3000';
    const expectedOrigin = localIp ? `http://${localIp}:3000` : 'http://localhost:3000';

    const response = await loginGet(
      new Request('http://localhost/api/auth/login', {
        headers: { host },
      }),
    );
    expect(response.status).toBe(307);
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'github',
      options: {
        redirectTo: `${expectedOrigin}/api/auth/callback`,
        scopes: 'repo',
        queryParams: { prompt: 'select_account' },
      },
    });
  });

  it('exchanges the callback code and stores only Supabase session tokens', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'verified-access',
          refresh_token: 'verified-refresh',
          expires_in: 3600,
          provider_token: 'gho_github-write-token',
          user: { id: 'user-a', user_metadata: { name: 'A' } },
        },
      },
      error: null,
    });

    const response = await callbackGet(
      new Request('http://localhost/api/auth/callback?code=valid'),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('set-cookie')).toContain('verified-access');
    expect(response.headers.get('set-cookie')).toContain('gho_github-write-token');
  });

  it('redirects home when the user cancels GitHub authorization', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';

    const response = await callbackGet(
      new Request(
        'http://localhost/api/auth/callback?error=access_denied&error_description=The+user+has+denied+your+application+access.',
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/');
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('maps non-cancel provider errors to auth_failed', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';

    const response = await callbackGet(
      new Request('http://localhost/api/auth/callback?error=server_error&error_code=unexpected'),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/?error=auth_failed');
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
