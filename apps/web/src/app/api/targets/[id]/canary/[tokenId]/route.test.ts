import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '../../../../../../utils/auth';
import { resetRateLimitsForTests } from '../../../../../../utils/rateLimit';
import type { CanaryTokenRow, Target } from '../../../../../../utils/dbAdapter';
import { ASSURLY_CANARY_PREFIX } from '@assurly/scanner-core';
import { DELETE } from './route';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));

vi.mock('../../../../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

const TARGET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_TOKEN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const db = {
  getTargetById: vi.fn(),
  listCanaryTokens: vi.fn(),
  deleteCanaryToken: vi.fn(),
};

function ownedTarget(overrides: Partial<Target> = {}): Target {
  return {
    id: TARGET_ID,
    organization_id: 'org-1',
    kind: 'repo',
    identifier: 'acme/app',
    display_name: 'App',
    repository_id: 'repo-1',
    generator_fingerprint: null,
    ownership_verified: true,
    ownership_method: null,
    current_verdict: 'ready',
    current_ship_score: 90,
    verdict_evidence: {},
    last_checked_at: null,
    badge_token: null,
    created_at: '2026-07-18T00:00:00.000Z',
    updated_at: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

function tokenRow(overrides: Partial<CanaryTokenRow> = {}): CanaryTokenRow {
  return {
    id: TOKEN_ID,
    organization_id: 'org-1',
    target_id: TARGET_ID,
    token_prefix: `${ASSURLY_CANARY_PREFIX}bbbbbb`,
    label: 'Staging decoy',
    last_hit_at: null,
    hit_count: 0,
    revoked_at: '2026-07-20T00:00:00.000Z',
    created_at: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

function deleteRequest(): Request {
  return new Request(`http://localhost/api/targets/${TARGET_ID}/canary/${TOKEN_ID}`, {
    method: 'DELETE',
  });
}

function routeContext(
  id: string = TARGET_ID,
  tokenId: string = TOKEN_ID,
): { params: Promise<{ id: string; tokenId: string }> } {
  return { params: Promise.resolve({ id, tokenId }) };
}

describe('DELETE /api/targets/[id]/canary/[tokenId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-1', name: 'User', email: 'u@example.com', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getTargetById.mockResolvedValue(ownedTarget());
    db.listCanaryTokens.mockResolvedValue([tokenRow()]);
    db.deleteCanaryToken.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated and never touches the adapter', async () => {
    mocks.requireUser.mockRejectedValue(new AuthenticationError());
    const res = await DELETE(deleteRequest(), routeContext());
    expect(res.status).toBe(401);
    expect(db.listCanaryTokens).not.toHaveBeenCalled();
    expect(db.deleteCanaryToken).not.toHaveBeenCalled();
  });

  it('returns 404 when the token is not on this target (other org / stranger)', async () => {
    db.listCanaryTokens.mockResolvedValue([tokenRow({ id: OTHER_TOKEN_ID })]);
    const res = await DELETE(deleteRequest(), routeContext());
    expect(res.status).toBe(404);
    expect(db.deleteCanaryToken).not.toHaveBeenCalled();
  });

  it('deletes a revoked canary', async () => {
    const res = await DELETE(deleteRequest(), routeContext());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(db.deleteCanaryToken).toHaveBeenCalledWith(TOKEN_ID);
  });

  it('rejects deleting a non-revoked canary with 409 and never calls deleteCanaryToken', async () => {
    db.listCanaryTokens.mockResolvedValue([tokenRow({ revoked_at: null })]);
    const res = await DELETE(deleteRequest(), routeContext());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('canary_active');
    expect(String(body.error.message).toLowerCase()).toContain('revoke');
    expect(db.deleteCanaryToken).not.toHaveBeenCalled();
  });

  it('returns 403 when ownership is not verified on a URL target', async () => {
    db.getTargetById.mockResolvedValue(
      ownedTarget({
        kind: 'url',
        ownership_verified: false,
        identifier: 'https://app.example',
      }),
    );
    const res = await DELETE(deleteRequest(), routeContext());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ownership_required');
    expect(db.deleteCanaryToken).not.toHaveBeenCalled();
  });
});
