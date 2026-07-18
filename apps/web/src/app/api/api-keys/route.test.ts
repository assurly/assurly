import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

import { GET, POST } from './route';
import { resetRateLimitsForTests } from '../../../utils/rateLimit';
import { hashApiKey } from '../../../utils/apiKeys';
import type { ApiKeyRow, CreateApiKeyInput } from '../../../utils/dbAdapter';

const db = {
  getOrganizationByUserId: vi.fn(),
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
};

function storedRow(overrides: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    id: 'key-1',
    organization_id: 'org-1',
    label: 'Cursor agent',
    key_prefix: 'ask_live_ab12cd',
    plan: 'free',
    last_used_at: null,
    revoked_at: null,
    created_at: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

function createRequest(label = 'Cursor agent'): Request {
  return new Request('http://localhost/api/api-keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label }),
  });
}

describe('POST /api/api-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-1', name: 'User', email: 'u@example.com', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getOrganizationByUserId.mockResolvedValue({ id: 'org-1', billing_plan: 'free' });
    db.createApiKey.mockImplementation((input: CreateApiKeyInput) =>
      Promise.resolve(
        storedRow({ label: input.label, key_prefix: input.keyPrefix, plan: input.plan }),
      ),
    );
  });

  it('returns the plaintext exactly once and persists ONLY the hash', async () => {
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const res = await POST(createRequest());
    expect(res.status).toBe(201);
    const body = await res.json();

    // Plaintext is returned to the caller here, and only here.
    expect(body.apiKey).toMatch(/^ask_live_[A-Za-z0-9_-]{32,}$/);

    // What was persisted: the hash, never the plaintext.
    const persisted = db.createApiKey.mock.calls[0][0] as CreateApiKeyInput;
    expect(persisted.keyHash).toBe(hashApiKey(body.apiKey));
    expect(persisted.keyHash).not.toBe(body.apiKey);
    expect(JSON.stringify(persisted)).not.toContain(body.apiKey);
    // The persisted input carries no plaintext field of any name.
    expect(Object.values(persisted)).not.toContain(body.apiKey);

    // The response key metadata never carries the hash or plaintext.
    expect(body.key).not.toHaveProperty('key_hash');
    expect(body.key).not.toHaveProperty('keyHash');
    expect(JSON.stringify(body.key)).not.toContain(body.apiKey);

    // The plaintext is never logged.
    for (const call of logSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(body.apiKey);
    }
    logSpy.mockRestore();
  });

  it('snapshots the org plan onto the key', async () => {
    db.getOrganizationByUserId.mockResolvedValue({ id: 'org-1', billing_plan: 'pro' });
    await POST(createRequest());
    const persisted = db.createApiKey.mock.calls[0][0] as CreateApiKeyInput;
    expect(persisted.plan).toBe('pro');
  });

  it('rejects creation when the user has no organization (400)', async () => {
    db.getOrganizationByUserId.mockResolvedValue(null);
    const res = await POST(createRequest());
    expect(res.status).toBe(400);
    expect(db.createApiKey).not.toHaveBeenCalled();
  });
});

describe('GET /api/api-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-1', name: 'User', email: 'u@example.com', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getOrganizationByUserId.mockResolvedValue({ id: 'org-1', billing_plan: 'free' });
  });

  it('lists keys without ever exposing a hash or plaintext', async () => {
    db.listApiKeys.mockResolvedValue([storedRow()]);
    const res = await GET(new Request('http://localhost/api/api-keys'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]).toMatchObject({ id: 'key-1', keyPrefix: 'ask_live_ab12cd', plan: 'free' });
    expect(JSON.stringify(body)).not.toContain('key_hash');
  });

  it('returns an empty list when the user has no organization', async () => {
    db.getOrganizationByUserId.mockResolvedValue(null);
    const res = await GET(new Request('http://localhost/api/api-keys'));
    const body = await res.json();
    expect(body.keys).toEqual([]);
  });
});
