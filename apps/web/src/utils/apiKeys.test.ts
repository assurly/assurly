import { describe, expect, it, vi } from 'vitest';
import {
  API_KEY_PREFIX,
  authenticateApiKey,
  generateApiKey,
  hashApiKey,
  isValidApiKeyFormat,
  parseBearerApiKey,
} from './apiKeys';
import type { ApiKeyAuthContext, DbAdapter } from './dbAdapter';

function authDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    getApiKeyByHash: vi.fn().mockResolvedValue(null),
    touchApiKey: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DbAdapter;
}

function bearer(key: string): Request {
  return new Request('https://assurly.dev/api/v1/verdict', {
    headers: { authorization: `Bearer ${key}` },
  });
}

describe('generateApiKey / hashApiKey', () => {
  it('mints a prefixed, high-entropy key and stores only its sha256 hash', () => {
    const generated = generateApiKey();
    expect(generated.plaintext.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(generated.keyHash).toMatch(/^[a-f0-9]{64}$/);
    // The hash is derived from the plaintext but is NOT the plaintext.
    expect(generated.keyHash).toBe(hashApiKey(generated.plaintext));
    expect(generated.keyHash).not.toBe(generated.plaintext);
    // The display prefix is a non-secret fragment of the plaintext, far shorter.
    expect(generated.plaintext.startsWith(generated.keyPrefix)).toBe(true);
    expect(generated.keyPrefix.length).toBeLessThan(generated.plaintext.length);
  });

  it('produces a distinct key each time', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.keyHash).not.toBe(b.keyHash);
  });

  it('hashApiKey is deterministic', () => {
    const key = generateApiKey().plaintext;
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });
});

describe('isValidApiKeyFormat / parseBearerApiKey', () => {
  it('accepts a well-formed key and rejects malformed ones', () => {
    expect(isValidApiKeyFormat(generateApiKey().plaintext)).toBe(true);
    expect(isValidApiKeyFormat('nope')).toBe(false);
    expect(isValidApiKeyFormat('ask_live_short')).toBe(false);
    expect(isValidApiKeyFormat('sk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toBe(false);
  });

  it('extracts a valid bearer key, else null', () => {
    const key = generateApiKey().plaintext;
    expect(parseBearerApiKey(bearer(key))).toBe(key);
    expect(parseBearerApiKey(new Request('https://x'))).toBeNull();
    expect(parseBearerApiKey(bearer('malformed'))).toBeNull();
    expect(
      parseBearerApiKey(new Request('https://x', { headers: { authorization: `Token ${key}` } })),
    ).toBeNull();
  });
});

describe('authenticateApiKey', () => {
  it('resolves an org context for a valid, non-revoked key and touches last-used', async () => {
    const row: ApiKeyAuthContext = {
      id: 'key-1',
      organization_id: 'org-1',
      plan: 'pro',
      organization_billing_plan: 'pro',
      revoked_at: null,
    };
    const touchApiKey = vi.fn().mockResolvedValue(undefined);
    const db = authDb({ getApiKeyByHash: vi.fn().mockResolvedValue(row), touchApiKey });

    const context = await authenticateApiKey(bearer(generateApiKey().plaintext), {
      getDb: () => db,
    });

    expect(context).toEqual({ id: 'key-1', organizationId: 'org-1', plan: 'pro' });
    expect(touchApiKey).toHaveBeenCalledWith('key-1');
  });

  it('enforces the live organization plan, not the snapshotted key plan', async () => {
    const row: ApiKeyAuthContext = {
      id: 'key-1',
      organization_id: 'org-1',
      plan: 'pro',
      organization_billing_plan: 'free',
      revoked_at: null,
    };
    const context = await authenticateApiKey(bearer(generateApiKey().plaintext), {
      getDb: () => authDb({ getApiKeyByHash: vi.fn().mockResolvedValue(row) }),
    });
    expect(context).toEqual({ id: 'key-1', organizationId: 'org-1', plan: 'free' });
  });

  it('fails closed when the live organization plan is missing', async () => {
    const context = await authenticateApiKey(bearer(generateApiKey().plaintext), {
      getDb: () =>
        authDb({
          getApiKeyByHash: vi.fn().mockResolvedValue({
            id: 'key-1',
            organization_id: 'org-1',
            plan: 'pro',
            revoked_at: null,
          }),
        }),
    });
    expect(context).toBeNull();
  });

  it('returns null for a revoked key', async () => {
    const db = authDb({
      getApiKeyByHash: vi.fn().mockResolvedValue({
        id: 'key-1',
        organization_id: 'org-1',
        plan: 'free',
        organization_billing_plan: 'free',
        revoked_at: '2026-07-18T00:00:00.000Z',
      }),
    });
    expect(
      await authenticateApiKey(bearer(generateApiKey().plaintext), { getDb: () => db }),
    ).toBeNull();
  });

  it('returns null for an unknown key', async () => {
    const db = authDb({ getApiKeyByHash: vi.fn().mockResolvedValue(null) });
    expect(
      await authenticateApiKey(bearer(generateApiKey().plaintext), { getDb: () => db }),
    ).toBeNull();
  });

  it('returns null (no DB lookup) for a missing or malformed key', async () => {
    const getApiKeyByHash = vi.fn().mockResolvedValue(null);
    const db = authDb({ getApiKeyByHash });
    expect(await authenticateApiKey(new Request('https://x'), { getDb: () => db })).toBeNull();
    expect(await authenticateApiKey(bearer('malformed'), { getDb: () => db })).toBeNull();
    expect(getApiKeyByHash).not.toHaveBeenCalled();
  });
});
