import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  getAdminDbAdapter: vi.fn(),
}));

vi.mock('../../../../utils/apiKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/apiKeys')>()),
  authenticateApiKey: mocks.authenticateApiKey,
}));
vi.mock('../../../../utils/dbAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/dbAdapter')>()),
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));

import { GET } from './route';
import { resetRateLimitsForTests } from '../../../../utils/rateLimit';
import { PROGRAMMATIC_VERDICT_KEYS } from '../../../../utils/programmaticVerdict';
import type { Target } from '../../../../utils/dbAdapter';

function target(overrides: Partial<Target> = {}): Target {
  return {
    id: 'target-1',
    organization_id: 'org-1',
    kind: 'url',
    identifier: 'https://app.example.com',
    display_name: 'Example app',
    repository_id: null,
    generator_fingerprint: 'lovable',
    ownership_verified: false,
    ownership_method: null,
    current_verdict: 'blocked',
    current_ship_score: 80,
    verdict_evidence: { topIssue: { key: 'rls:invoices', severity: 'error' } },
    last_checked_at: '2026-07-18T06:00:00.000Z',
    badge_token: 'a'.repeat(32),
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-18T06:00:00.000Z',
    ...overrides,
  };
}

function useKey(plan: 'free' | 'pro' = 'free'): void {
  mocks.authenticateApiKey.mockResolvedValue({ id: 'key-1', organizationId: 'org-1', plan });
}

function useTarget(row: Target | null): ReturnType<typeof vi.fn> {
  const getTargetByIdentifier = vi.fn().mockResolvedValue(row);
  mocks.getAdminDbAdapter.mockReturnValue({ getTargetByIdentifier });
  return getTargetByIdentifier;
}

function call(url = 'https://app.example.com'): Promise<Response> {
  return GET(
    new Request(`http://localhost/api/v1/verdict?url=${encodeURIComponent(url)}`, {
      headers: { authorization: 'Bearer ask_live_dummy' },
    }),
  );
}

describe('GET /api/v1/verdict (keyed programmatic verdict)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
  });

  it('rejects a missing / malformed / revoked key with 401', async () => {
    mocks.authenticateApiKey.mockResolvedValue(null);
    useTarget(target());
    const res = await call();
    expect(res.status).toBe(401);
  });

  it('returns the shape-only verdict for a valid key', async () => {
    useKey('free');
    const lookup = useTarget(target({ ownership_verified: true }));
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('blocked');
    expect(body.shipScore).toBe(80);
    expect(body.topIssue.category).toBe('Database access control (RLS)');
    expect(body.activeProbeAllowed).toBe(true);
    expect(lookup).toHaveBeenCalledWith('org-1', 'url', 'https://app.example.com');
    // Payload is shape-only: only whitelisted keys, and no leaked table name.
    expect(Object.keys(body).sort()).toEqual([...PROGRAMMATIC_VERDICT_KEYS].sort());
    expect(JSON.stringify(body)).not.toContain('invoices');
  });

  it('returns the PASSIVE verdict and triggers ZERO active probe for an unverified target', async () => {
    useKey('free');
    const lookup = useTarget(target({ ownership_verified: false }));
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    // Stored (passive) verdict is returned; active probing is reported not-allowed.
    expect(body.activeProbeAllowed).toBe(false);
    // Side-effect assertion: the only DB call is a single scoped read. The admin
    // adapter exposes no probe/scan/re-probe method here, so no active probe is possible.
    expect(lookup).toHaveBeenCalledTimes(1);
    const adapter = mocks.getAdminDbAdapter.mock.results[0]?.value as Record<string, unknown>;
    expect(Object.keys(adapter)).toEqual(['getTargetByIdentifier']);
  });

  it('returns unknown for a target the org does not own', async () => {
    useKey('free');
    useTarget(null);
    const res = await call('https://stranger.example.com');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('unknown');
    expect(body.activeProbeAllowed).toBe(false);
  });

  it('rejects a request with neither url nor repo (400)', async () => {
    useKey('free');
    useTarget(target());
    const res = await GET(
      new Request('http://localhost/api/v1/verdict', {
        headers: { authorization: 'Bearer ask_live_dummy' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('enforces the plan-based rate limit (free tier)', async () => {
    useKey('free');
    useTarget(target({ ownership_verified: true }));
    const limit = 60; // RATE_LIMITS.apiKeyFree
    let last = 200;
    for (let i = 0; i < limit; i += 1) {
      last = (await call()).status;
    }
    expect(last).toBe(200);
    const overLimit = await call();
    expect(overLimit.status).toBe(429);
  });
});
