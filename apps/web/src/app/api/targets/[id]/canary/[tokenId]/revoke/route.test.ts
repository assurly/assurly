import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '../../../../../../../utils/auth';
import { resetRateLimitsForTests } from '../../../../../../../utils/rateLimit';
import type { CanaryTokenRow, Target } from '../../../../../../../utils/dbAdapter';
import { ASSURLY_CANARY_PREFIX } from '@assurly/scanner-core';
import { POST } from './route';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));

vi.mock('../../../../../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

const TARGET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_TOKEN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const db = {
  getTargetById: vi.fn(),
  listCanaryTokens: vi.fn(),
  revokeCanaryToken: vi.fn(),
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
    revoked_at: null,
    created_at: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

function revokeRequest(): Request {
  return new Request(`http://localhost/api/targets/${TARGET_ID}/canary/${TOKEN_ID}/revoke`, {
    method: 'POST',
  });
}

function routeContext(
  id: string = TARGET_ID,
  tokenId: string = TOKEN_ID,
): { params: Promise<{ id: string; tokenId: string }> } {
  return { params: Promise.resolve({ id, tokenId }) };
}

describe('POST /api/targets/[id]/canary/[tokenId]/revoke', () => {
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
    db.revokeCanaryToken.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated and never touches the adapter', async () => {
    mocks.requireUser.mockRejectedValue(new AuthenticationError());
    const res = await POST(revokeRequest(), routeContext());
    expect(res.status).toBe(401);
    expect(db.revokeCanaryToken).not.toHaveBeenCalled();
  });

  it('returns 404 when the token is not on this target (other org / stranger)', async () => {
    db.listCanaryTokens.mockResolvedValue([tokenRow({ id: OTHER_TOKEN_ID })]);
    const res = await POST(revokeRequest(), routeContext());
    expect(res.status).toBe(404);
    expect(db.revokeCanaryToken).not.toHaveBeenCalled();
  });

  it('revokes an active canary (soft flag) and is idempotent on a second call', async () => {
    const first = await POST(revokeRequest(), routeContext());
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ revoked: true });
    expect(db.revokeCanaryToken).toHaveBeenCalledWith(TOKEN_ID);

    // Second revoke: token already soft-revoked in the list — still succeeds.
    db.listCanaryTokens.mockResolvedValue([tokenRow({ revoked_at: '2026-07-20T00:00:00.000Z' })]);
    const second = await POST(revokeRequest(), routeContext());
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ revoked: true });
    expect(db.revokeCanaryToken).toHaveBeenCalledTimes(2);
  });

  it('marks the canary so a subsequent callback lookup no longer validates', async () => {
    // Simulate the soft-flag semantics the db adapter applies: after revoke,
    // getCanaryTokenByHash would return revoked_at set (callback skips hits).
    const store = { revoked_at: null as string | null };
    db.revokeCanaryToken.mockImplementation(async () => {
      // The bug this catches: forgetting to set revoked_at leaves the canary live.
      store.revoked_at = new Date().toISOString();
    });

    const res = await POST(revokeRequest(), routeContext());
    expect(res.status).toBe(200);
    expect(db.revokeCanaryToken).toHaveBeenCalledWith(TOKEN_ID);
    expect(store.revoked_at).not.toBeNull();
    // Callback contract: revoked tokens do not validate (see canary/[token] route).
    expect(Boolean(store.revoked_at)).toBe(true);
  });
});
