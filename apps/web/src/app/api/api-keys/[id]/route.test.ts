import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '../../../../utils/auth';
import { resetRateLimitsForTests } from '../../../../utils/rateLimit';
import type { ApiKeyRow } from '../../../../utils/dbAdapter';
import { DELETE } from './route';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('../../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

const KEY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_KEY_ID = '22222222-2222-4222-8222-222222222222';

const db = {
  getOrganizationByUserId: vi.fn(),
  listApiKeys: vi.fn(),
  deleteApiKey: vi.fn(),
};

function storedRow(overrides: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    id: KEY_ID,
    organization_id: 'org-1',
    label: 'Cursor agent',
    key_prefix: 'ask_live_ab12cd',
    plan: 'free',
    last_used_at: null,
    revoked_at: '2026-07-19T00:00:00.000Z',
    created_at: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

function deleteRequest(): Request {
  return new Request(`http://localhost/api/api-keys/${KEY_ID}`, { method: 'DELETE' });
}

function routeContext(id: string = KEY_ID): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('DELETE /api/api-keys/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-1', name: 'User', email: 'u@example.com', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getOrganizationByUserId.mockResolvedValue({ id: 'org-1', billing_plan: 'free' });
    db.listApiKeys.mockResolvedValue([storedRow()]);
    db.deleteApiKey.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated and never touches the adapter', async () => {
    mocks.requireUser.mockRejectedValue(new AuthenticationError());
    const res = await DELETE(deleteRequest(), routeContext());
    expect(res.status).toBe(401);
    expect(db.listApiKeys).not.toHaveBeenCalled();
    expect(db.deleteApiKey).not.toHaveBeenCalled();
  });

  it('returns 404 for a key that is not in the caller org (other tenant)', async () => {
    db.listApiKeys.mockResolvedValue([storedRow({ id: OTHER_KEY_ID })]);
    const res = await DELETE(deleteRequest(), routeContext(KEY_ID));
    expect(res.status).toBe(404);
    expect(db.deleteApiKey).not.toHaveBeenCalled();
  });

  it('deletes a revoked key', async () => {
    const res = await DELETE(deleteRequest(), routeContext());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(db.deleteApiKey).toHaveBeenCalledWith(KEY_ID);
  });

  it('rejects deleting a non-revoked key with 409 and never calls deleteApiKey', async () => {
    db.listApiKeys.mockResolvedValue([storedRow({ revoked_at: null })]);
    const res = await DELETE(deleteRequest(), routeContext());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('key_active');
    expect(String(body.error.message).toLowerCase()).toContain('revoke');
    expect(db.deleteApiKey).not.toHaveBeenCalled();
  });
});
