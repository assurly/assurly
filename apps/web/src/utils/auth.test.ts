import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthenticationError,
  clearLegacySupabaseAuthCookies,
  clearSessionCookie,
  getSessionUser,
  parseSessionCookie,
  requireUser,
  setSupabaseSessionCookie,
} from './auth';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserDbAdapter: vi.fn(() => ({ marker: 'user-scoped-db' })),
}));

vi.mock('./supabase', () => ({
  getSupabaseClient: () => ({ auth: { getUser: mocks.getUser } }),
}));

vi.mock('./dbAdapter', () => ({
  getUserDbAdapter: mocks.getUserDbAdapter,
}));

describe('authentication boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects the former unsigned mock session cookie', async () => {
    const cookie = encodeURIComponent(JSON.stringify({ userId: 'attacker', name: 'Admin' }));
    const request = new Request('http://localhost/api/scans', {
      headers: { cookie: `assurly-session=${cookie}` },
    });

    await expect(requireUser(request)).rejects.toBeInstanceOf(AuthenticationError);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('rejects an arbitrary long bearer token after Supabase verification fails', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error('invalid JWT'),
    });
    const request = new Request('http://localhost/api/scans', {
      headers: { authorization: `Bearer ${'x'.repeat(80)}` },
    });

    await expect(requireUser(request)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('returns a user-scoped database and GitHub token after the session is verified', async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-a',
          email: 'a@example.com',
          user_metadata: { name: 'User A' },
        },
      },
      error: null,
    });
    const cookie = encodeURIComponent(
      JSON.stringify({
        accessToken: 'verified-token',
        refreshToken: 'refresh',
        expiresAt: 9999999999,
        githubAccessToken: 'gho_user-token',
      }),
    );
    const request = new Request('http://localhost/api/scans', {
      headers: { cookie: `assurly-session=${cookie}` },
    });

    const context = await requireUser(request);
    expect(context.user.id).toBe('user-a');
    expect(context.githubAccessToken).toBe('gho_user-token');
    expect(mocks.getUserDbAdapter).toHaveBeenCalledWith('verified-token');
    expect(context.db).toEqual({ marker: 'user-scoped-db' });
  });

  it('returns null from the optional session helper when unauthenticated', async () => {
    expect(await getSessionUser(new Request('http://localhost/api/session'))).toBeNull();
  });

  it('sets only a Supabase session payload and clears it securely', () => {
    const cookie = setSupabaseSessionCookie({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });
    expect(cookie).toContain('assurly-session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(clearSessionCookie()).toContain('Max-Age=0');
  });

  it('parses a complete session cookie and rejects incomplete ones', () => {
    const complete = encodeURIComponent(
      JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresAt: 123 }),
    );
    const parsed = parseSessionCookie(
      new Request('http://localhost/api/auth/logout', {
        headers: { cookie: `assurly-session=${complete}` },
      }),
    );
    expect(parsed).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 123 });

    const accessOnly = encodeURIComponent(JSON.stringify({ accessToken: 'a' }));
    expect(
      parseSessionCookie(
        new Request('http://localhost/api/auth/logout', {
          headers: { cookie: `assurly-session=${accessOnly}` },
        }),
      ),
    ).toBeNull();
  });

  it('expires legacy Supabase auth-token cookies but not the PKCE verifier', () => {
    const request = new Request('http://localhost/api/auth/callback', {
      headers: {
        cookie:
          'sb-abc-auth-token=x; sb-abc-auth-token.0=y; sb-abc-auth-token-code-verifier=keep; assurly-session=z',
      },
    });

    const headers = clearLegacySupabaseAuthCookies(request);
    const cleared = headers.join('\n');

    expect(headers).toHaveLength(2);
    expect(cleared).toContain('sb-abc-auth-token=;');
    expect(cleared).toContain('sb-abc-auth-token.0=;');
    expect(cleared).not.toContain('code-verifier');
    expect(cleared).not.toContain('assurly-session=;');
    headers.forEach((header) => expect(header).toContain('Max-Age=0'));
  });
});
