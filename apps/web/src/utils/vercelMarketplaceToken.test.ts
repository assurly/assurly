import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bearerToken,
  MARKETPLACE_ISSUER,
  MarketplaceAuthError,
  resetMarketplaceJwksCache,
  verifyMarketplaceToken,
} from './vercelMarketplaceToken';

const CLIENT_ID = 'oac_test123';
const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const NOW_S = Math.floor(NOW / 1000);

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

function sign(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', kid: 'k1' },
  key: crypto.KeyObject = privateKey,
): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode(header)}.${encode(claims)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(body), key).toString('base64url');
  return `${body}.${signature}`;
}

const userClaims = {
  iss: MARKETPLACE_ISSUER,
  aud: CLIENT_ID,
  exp: NOW_S + 300,
  iat: NOW_S,
  sub: 'account:abc:user:def',
  account_id: 'acc_1',
  installation_id: 'icfg_abc123',
  user_id: 'user_1',
  user_role: 'ADMIN',
  user_email: 'dev@example.com',
  user_email_verified: true,
  user_name: 'Dev',
};

const systemClaims = {
  iss: MARKETPLACE_ISSUER,
  aud: CLIENT_ID,
  exp: NOW_S + 300,
  sub: 'account:abc',
  account_id: 'acc_1',
  installation_id: 'icfg_abc123',
};

function verify(token: string, jwks = vi.fn(async () => [jwk])) {
  return verifyMarketplaceToken(token, { clientId: CLIENT_ID, now: NOW, jwks });
}

async function rejection(token: string): Promise<string> {
  const error = await verify(token).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(MarketplaceAuthError);
  return (error as MarketplaceAuthError).reason;
}

describe('verifyMarketplaceToken', () => {
  beforeEach(() => resetMarketplaceJwksCache());

  it('accepts a user token and keeps only a verified email', async () => {
    const caller = await verify(sign(userClaims));
    expect(caller).toEqual({
      kind: 'user',
      installationId: 'icfg_abc123',
      accountId: 'acc_1',
      userId: 'user_1',
      userRole: 'ADMIN',
      verifiedEmail: 'dev@example.com',
      userName: 'Dev',
    });
    const unverified = await verify(sign({ ...userClaims, user_email_verified: false }));
    expect(unverified.verifiedEmail).toBeNull();
  });

  it('reads the standard OIDC email claims an SSO id_token may carry', async () => {
    const base = {
      ...userClaims,
      user_email: undefined,
      user_email_verified: undefined,
      user_name: undefined,
    };
    const sso = await verify(
      sign({ ...base, email: 'Dev@Example.com', email_verified: true, name: 'Dev' }),
    );
    expect(sso.verifiedEmail).toBe('dev@example.com');
    expect(sso.userName).toBe('Dev');
    const unverified = await verify(
      sign({ ...base, email: 'dev@example.com', email_verified: false }),
    );
    expect(unverified.verifiedEmail).toBeNull();
    const garbage = await verify(sign({ ...base, email: 'not-an-email', email_verified: true }));
    expect(garbage.verifiedEmail).toBeNull();
  });

  it('accepts a system token', async () => {
    const caller = await verify(sign(systemClaims));
    expect(caller.kind).toBe('system');
    expect(caller.userRole).toBeNull();
  });

  it('rejects a token signed by another key', async () => {
    expect(await rejection(sign(userClaims, undefined, other.privateKey))).toBe('bad signature');
  });

  it('rejects a tampered payload', async () => {
    const [header, , signature] = sign(userClaims).split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...userClaims, user_role: 'ADMIN', account_id: 'x' }),
    ).toString('base64url');
    expect(await rejection(`${header}.${forged}.${signature}`)).toBe('bad signature');
  });

  it('pins RS256', async () => {
    expect(await rejection(sign(userClaims, { alg: 'none', kid: 'k1' }))).toBe(
      'unsupported algorithm',
    );
    expect(await rejection(sign(userClaims, { alg: 'HS256', kid: 'k1' }))).toBe(
      'unsupported algorithm',
    );
  });

  it('rejects another audience, another issuer and an expired token', async () => {
    expect(await rejection(sign({ ...userClaims, aud: 'oac_other' }))).toBe('audience');
    expect(await rejection(sign({ ...userClaims, iss: 'https://evil.example' }))).toBe('claims');
    expect(await rejection(sign({ ...userClaims, exp: NOW_S - 120 }))).toBe('expired');
    expect(await rejection(sign({ ...userClaims, nbf: NOW_S + 600 }))).toBe('not yet valid');
  });

  it('rejects a user token without a role', async () => {
    expect(await rejection(sign({ ...userClaims, user_role: undefined }))).toBe('claims');
  });

  it('rejects garbage', async () => {
    expect(await rejection('not-a-jwt')).toBe('malformed');
    expect(await rejection('a.b.c')).toBe('malformed');
  });

  it('caches the key set and refetches once for an unknown kid', async () => {
    const jwks = vi.fn(async () => [jwk]);
    await verify(sign(userClaims), jwks);
    await verify(sign(userClaims), jwks);
    expect(jwks).toHaveBeenCalledTimes(1);

    const error = await verify(sign(userClaims, { alg: 'RS256', kid: 'k2' }), jwks).catch(
      (caught: unknown) => caught,
    );
    expect((error as MarketplaceAuthError).reason).toBe('unknown key');
    // Within the refresh floor an unknown kid does not hammer the endpoint.
    expect(jwks).toHaveBeenCalledTimes(1);
  });
});

describe('bearerToken', () => {
  it('reads a bearer token and ignores anything else', () => {
    const request = (value?: string) =>
      new Request('https://x.test', { headers: value ? { authorization: value } : {} });
    expect(bearerToken(request('Bearer a.b.c'))).toBe('a.b.c');
    expect(bearerToken(request('Basic abc'))).toBeNull();
    expect(bearerToken(request())).toBeNull();
  });
});
