import { describe, expect, it, vi } from 'vitest';
import type { DbAdapter, VercelInstallationRow } from './dbAdapter';
import {
  completeVercelSso,
  exchangeSsoCode,
  roleFor,
  SsoError,
  ssoDestination,
  type SsoDeps,
} from './vercelSso';
import { VercelApiError } from './vercelIntegration';
import type { MarketplaceCaller } from './vercelMarketplaceToken';

const CONFIG = { clientId: 'oac_test', clientSecret: 'secret', slug: 'assurly' };
const APP = 'https://assurly.dev';

function caller(overrides: Partial<MarketplaceCaller> = {}): MarketplaceCaller {
  return {
    kind: 'user',
    installationId: 'icfg_abc123',
    accountId: 'acc_1',
    userId: 'user_1',
    userRole: 'ADMIN',
    verifiedEmail: 'dev@example.com',
    userName: 'Dev',
    ...overrides,
  };
}

function setup(overrides: Partial<SsoDeps> = {}) {
  const db = {
    getVercelInstallation: vi.fn(
      async (): Promise<VercelInstallationRow | null> => ({
        organization_id: 'org-vercel',
        account_id: 'acc_1',
        token_ciphertext: 'c',
        billing_plan_id: 'free',
      }),
    ),
    joinVercelInstallation: vi.fn(async (): Promise<string | null> => 'org-vercel'),
  };
  const session = { accessToken: 'at', refreshToken: 'rt', expiresAt: 2_000_000_000 };
  const deps: SsoDeps = {
    config: CONFIG,
    db: db as unknown as DbAdapter,
    exchange: vi.fn(async () => 'id.token.jwt'),
    verify: vi.fn(async () => caller()),
    issueSession: vi.fn(async () => ({ userId: 'supabase-user', session })),
    ...overrides,
  };
  return { db, deps, session };
}

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(SsoError);
  return (error as SsoError).reason;
}

describe('exchangeSsoCode', () => {
  it('posts the code, state and client credentials as JSON', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id_token: 'jwt' }));
    expect(await exchangeSsoCode('code-1', 'state-1', CONFIG, fetchImpl)).toBe('jwt');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.vercel.com/v1/integrations/sso/token');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      code: 'code-1',
      state: 'state-1',
      client_id: 'oac_test',
      client_secret: 'secret',
    });
  });

  it('keeps Vercel’s error and never echoes the secret', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { code: 'invalid_grant', message: 'Code expired' } }, { status: 400 }),
    );
    const error = await exchangeSsoCode('c', null, CONFIG, fetchImpl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VercelApiError);
    expect(String((error as Error).message)).toContain('invalid_grant');
    expect(String((error as Error).message)).not.toContain('secret');
  });

  it('fails cleanly on a missing id_token or a network error', async () => {
    expect(
      await failure(
        exchangeSsoCode(
          'c',
          null,
          CONFIG,
          vi.fn(async () => Response.json({})),
        ),
      ),
    ).toBe('exchange_failed');
    expect(
      await failure(
        exchangeSsoCode(
          'c',
          null,
          CONFIG,
          vi.fn(async () => Promise.reject(new TypeError('net'))),
        ),
      ),
    ).toBe('exchange_failed');
  });
});

describe('ssoDestination', () => {
  it('opens the dashboard by default and for a resource', () => {
    expect(ssoDestination({ code: 'c' }, APP)).toBe('https://assurly.dev/dashboard');
    expect(ssoDestination({ code: 'c', resource_id: 'r', path: 'billing' }, APP)).toBe(
      'https://assurly.dev/dashboard',
    );
  });

  it('sends a support request to the contact form', () => {
    expect(ssoDestination({ code: 'c', support: 'true' }, APP)).toBe(
      'https://assurly.dev/?subject=technical#contact',
    );
    expect(ssoDestination({ code: 'c', path: 'support' }, APP)).toBe(
      'https://assurly.dev/?subject=technical#contact',
    );
  });

  it('follows url only inside Assurly', () => {
    expect(ssoDestination({ code: 'c', url: 'https://assurly.dev/live-lock?x=1' }, APP)).toBe(
      'https://assurly.dev/live-lock?x=1',
    );
    expect(ssoDestination({ code: 'c', url: 'sso:https://assurly.dev/dashboard' }, APP)).toBe(
      'https://assurly.dev/dashboard',
    );
    for (const url of [
      'https://evil.example/phish',
      '//evil.example/phish',
      'javascript:alert(1)',
      'https://assurly.dev.evil.example/',
      'http://assurly.dev/dashboard',
    ]) {
      expect(ssoDestination({ code: 'c', url }, APP)).toBe('https://assurly.dev/dashboard');
    }
  });
});

describe('completeVercelSso', () => {
  it('signs the person in and joins the installation’s workspace as admin', async () => {
    const { db, deps, session } = setup();
    const result = await completeVercelSso({ code: 'c', state: 's' }, deps);
    expect(deps.exchange).toHaveBeenCalledWith('c', 's');
    expect(deps.issueSession).toHaveBeenCalledWith('dev@example.com', 'Dev');
    expect(db.joinVercelInstallation).toHaveBeenCalledWith('icfg_abc123', 'supabase-user', 'admin');
    expect(result).toEqual({ userId: 'supabase-user', session, organizationId: 'org-vercel' });
  });

  it('a Vercel USER becomes a member', () => {
    expect(roleFor(caller({ userRole: 'USER' }))).toBe('member');
    expect(roleFor(caller())).toBe('admin');
  });

  it('refuses an unverified email before creating any session', async () => {
    const { deps } = setup({ verify: vi.fn(async () => caller({ verifiedEmail: null })) });
    expect(await failure(completeVercelSso({ code: 'c' }, deps))).toBe('email_unverified');
    expect(deps.issueSession).not.toHaveBeenCalled();
  });

  it('refuses a team without an installation', async () => {
    const { db, deps } = setup();
    db.getVercelInstallation.mockResolvedValueOnce(null);
    expect(await failure(completeVercelSso({ code: 'c' }, deps))).toBe('unknown_installation');
    expect(deps.issueSession).not.toHaveBeenCalled();
  });

  it('refuses a token that is not a user token or does not verify', async () => {
    const system = setup({
      verify: vi.fn(async () => caller({ kind: 'system', userId: null, userRole: null })),
    });
    expect(await failure(completeVercelSso({ code: 'c' }, system.deps))).toBe('invalid_token');
    const forged = setup({ verify: vi.fn(async () => Promise.reject(new Error('bad signature'))) });
    expect(await failure(completeVercelSso({ code: 'c' }, forged.deps))).toBe('invalid_token');
  });

  it('reports an expired code and a missing configuration', async () => {
    const expired = setup({
      exchange: vi.fn(async () => Promise.reject(new VercelApiError(400, 'sso exchange'))),
    });
    expect(await failure(completeVercelSso({ code: 'c' }, expired.deps))).toBe('exchange_failed');
    const unconfigured = setup({ config: null });
    expect(await failure(completeVercelSso({ code: 'c' }, unconfigured.deps))).toBe(
      'not_configured',
    );
  });

  it('keeps Vercel’s reason for the server log', async () => {
    const { deps } = setup({
      exchange: vi.fn(async () =>
        Promise.reject(new VercelApiError(400, 'sso exchange', 'invalid_grant Code expired')),
      ),
    });
    const error = await completeVercelSso({ code: 'c' }, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SsoError);
    expect((error as SsoError).detail).toContain('invalid_grant Code expired');
    expect((error as SsoError).message).not.toContain('secret');
  });

  it('reports a failed session and an installation removed mid-flight', async () => {
    const broken = setup({ issueSession: vi.fn(async () => Promise.reject(new Error('down'))) });
    expect(await failure(completeVercelSso({ code: 'c' }, broken.deps))).toBe('session_failed');
    const removed = setup();
    removed.db.joinVercelInstallation.mockResolvedValueOnce(null);
    expect(await failure(completeVercelSso({ code: 'c' }, removed.deps))).toBe(
      'unknown_installation',
    );
  });
});
