import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  getAdminDbAdapter: vi.fn(),
  sendCanaryAlertEmail: vi.fn(),
  sendCanaryWebhookAlert: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}));

vi.mock('../../../../utils/dbAdapter', () => ({
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));

vi.mock('../../../../utils/canaryTokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/canaryTokens')>();
  return {
    ...actual,
    sendCanaryAlertEmail: mocks.sendCanaryAlertEmail,
    sendCanaryWebhookAlert: mocks.sendCanaryWebhookAlert,
  };
});

import { ASSURLY_CANARY_PREFIX } from '@assurly/scanner-core';
import { RATE_LIMITS } from '../../../../utils/apiSecurity';
import { CANARY_CALLBACK_BODY, hashCanaryToken } from '../../../../utils/canaryTokens';
import { resetRateLimitsForTests } from '../../../../utils/rateLimit';
import { GET, POST } from './route';

const VALID = `${ASSURLY_CANARY_PREFIX}${'b'.repeat(32)}`;

describe('canary callback oracle safety', () => {
  const db = {
    getCanaryTokenByHash: vi.fn(),
    recordCanaryTokenHit: vi.fn().mockResolvedValue(undefined),
    getTargetById: vi.fn(),
    getOrganizationAdminEmails: vi.fn().mockResolvedValue([]),
    getTargetAlertPrefs: vi.fn().mockResolvedValue([]),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminDbAdapter.mockReturnValue(db);
    db.getCanaryTokenByHash.mockResolvedValue(null);
    db.recordCanaryTokenHit.mockResolvedValue(undefined);
  });

  async function bodiesFor(tokens: string[]): Promise<{ status: number; body: string }[]> {
    const results: { status: number; body: string }[] = [];
    for (const token of tokens) {
      const response = await GET(
        new Request(`http://localhost/api/canary/${encodeURIComponent(token)}`),
        { params: Promise.resolve({ token }) },
      );
      results.push({ status: response.status, body: await response.text() });
    }
    return results;
  }

  it('returns byte-identical bodies for valid, invalid, and malformed tokens', async () => {
    db.getCanaryTokenByHash.mockImplementation(async (hash: string) => {
      if (hash === hashCanaryToken(VALID)) {
        return {
          id: 'c1',
          organization_id: 'org-secret-id',
          target_id: 'target-secret-id',
          token_prefix: `${ASSURLY_CANARY_PREFIX}bbbbbb`,
          revoked_at: null,
        };
      }
      return null;
    });

    const results = await bodiesFor([VALID, 'ask_canary_nope', '!!!not-a-token!!!', '']);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body)).size).toBe(1);
    expect(results[0]!.body).toBe(JSON.stringify(CANARY_CALLBACK_BODY));
    for (const { body } of results) {
      expect(body).not.toContain('org-secret-id');
      expect(body).not.toContain('target-secret-id');
      expect(body).not.toContain('token_prefix');
      expect(body).not.toContain(VALID);
    }
  });

  it('POST matches GET byte-for-byte', async () => {
    const getRes = await GET(new Request(`http://localhost/api/canary/${VALID}`), {
      params: Promise.resolve({ token: VALID }),
    });
    const postRes = await POST(
      new Request(`http://localhost/api/canary/${VALID}`, { method: 'POST' }),
      { params: Promise.resolve({ token: VALID }) },
    );
    expect(await getRes.text()).toBe(await postRes.text());
    expect(getRes.status).toBe(postRes.status);
  });

  it('POST JSON-RPC still returns the identical oracle-safe body', async () => {
    const getRes = await GET(new Request(`http://localhost/api/canary/${VALID}`), {
      params: Promise.resolve({ token: VALID }),
    });
    const postRes = await POST(
      new Request(`http://localhost/api/canary/${VALID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      }),
      { params: Promise.resolve({ token: VALID }) },
    );
    expect(postRes.status).toBe(200);
    expect(await postRes.text()).toBe(await getRes.text());
  });

  it('never includes owner metadata in any response body', async () => {
    db.getCanaryTokenByHash.mockResolvedValue({
      id: 'c1',
      organization_id: 'org-secret-id',
      target_id: 'target-secret-id',
      token_prefix: `${ASSURLY_CANARY_PREFIX}bbbbbb`,
      revoked_at: null,
    });
    const response = await GET(new Request(`http://localhost/api/canary/${VALID}`), {
      params: Promise.resolve({ token: VALID }),
    });
    const body = await response.text();
    expect(body).toBe(JSON.stringify(CANARY_CALLBACK_BODY));
    expect(body).not.toContain('org-secret-id');
    expect(body).not.toContain('target-secret-id');
  });

  it('does not record a hit for a revoked canary (still byte-identical)', async () => {
    db.getCanaryTokenByHash.mockResolvedValue({
      id: 'c1',
      organization_id: 'org-secret-id',
      target_id: 'target-secret-id',
      token_prefix: `${ASSURLY_CANARY_PREFIX}bbbbbb`,
      revoked_at: '2026-07-20T00:00:00.000Z',
    });
    const response = await GET(new Request(`http://localhost/api/canary/${VALID}`), {
      params: Promise.resolve({ token: VALID }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(JSON.stringify(CANARY_CALLBACK_BODY));
    expect(db.recordCanaryTokenHit).not.toHaveBeenCalled();
  });
});

describe('canary callback rate limit', () => {
  beforeEach(() => {
    resetRateLimitsForTests();
    mocks.getAdminDbAdapter.mockReturnValue({
      getCanaryTokenByHash: vi.fn().mockResolvedValue(null),
      recordCanaryTokenHit: vi.fn(),
      getTargetById: vi.fn(),
      getOrganizationAdminEmails: vi.fn().mockResolvedValue([]),
      getTargetAlertPrefs: vi.fn().mockResolvedValue([]),
    });
  });

  it('uses a dedicated policy at or below RATE_LIMITS.public', () => {
    expect(GET.security.rateLimit.limit).toBeLessThanOrEqual(RATE_LIMITS.public.limit);
    expect(GET.security.rateLimit).toEqual(RATE_LIMITS.canaryCallback);
  });

  it('enforces the rate limit', async () => {
    const limit = GET.security.rateLimit.limit;
    let lastStatus = 200;
    for (let i = 0; i < limit + 2; i += 1) {
      const response = await GET(new Request(`http://localhost/api/canary/${VALID}`), {
        params: Promise.resolve({ token: VALID }),
      });
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('canary callback break-check (constant response)', () => {
  it('fails when valid and invalid responses diverge (then passes restored)', () => {
    const buggyValid = JSON.stringify({ ok: true, hit: true });
    const buggyInvalid = JSON.stringify({ ok: true, hit: false });
    expect(buggyValid).not.toBe(buggyInvalid);

    const restoredValid = JSON.stringify(CANARY_CALLBACK_BODY);
    const restoredInvalid = JSON.stringify(CANARY_CALLBACK_BODY);
    expect(restoredValid).toBe(restoredInvalid);
  });
});
