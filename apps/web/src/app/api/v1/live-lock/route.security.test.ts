import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRateLimitsForTests } from '../../../../utils/rateLimit';
import type { Target } from '../../../../utils/dbAdapter';

/**
 * Live Lock may call the real scanner. An unverified URL must not be fetched.
 * A verified URL may only be read with GET or HEAD.
 */

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

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '203.0.113.10', family: 4 }]),
  resolveTxt: vi.fn(async () => []),
}));

import { POST } from './route';

const PAGE = 'https://myapp.example/';

function target(ownershipVerified: boolean): Target {
  return {
    id: 'target-1',
    organization_id: 'org-1',
    kind: 'url',
    identifier: 'https://myapp.example',
    display_name: 'Example',
    repository_id: null,
    generator_fingerprint: null,
    ownership_verified: ownershipVerified,
    ownership_method: ownershipVerified ? 'dns_txt' : null,
    current_verdict: 'unknown',
    current_ship_score: null,
    verdict_evidence: null,
    last_checked_at: null,
    badge_token: 'b'.repeat(32),
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  };
}

function dbFor(row: Target | null) {
  const store = new Map<string, Record<string, unknown>>();
  return {
    getTargetByIdentifier: vi.fn(async () => row),
    getLiveLockAttempt: vi.fn(async (_targetId: string, attemptId: string) => {
      return store.get(attemptId) ?? null;
    }),
    insertLiveLockAttempt: vi.fn(async (input: { attemptId: string; status: string }) => {
      const stored = {
        id: 'row-1',
        organization_id: 'org-1',
        target_id: 'target-1',
        git_sha: 'abc1234',
        attempt_id: input.attemptId,
        status: input.status,
        ship_score: 0,
        reason: 'ownership_unverified',
        created_at: '2026-10-23T12:00:00.000Z',
      };
      store.set(input.attemptId, stored);
      return stored;
    }),
    getFixOutcomesForTarget: vi.fn(async () => []),
    insertFixOutcomes: vi.fn(async () => undefined),
    deleteProbeEvidenceForTarget: vi.fn(async () => undefined),
    insertProbeEvidence: vi.fn(async () => undefined),
    upsertTarget: vi.fn(async () => row),
  };
}

function call(attemptId: string): Promise<Response> {
  return POST(
    new Request('http://localhost/api/v1/live-lock', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ask_live_dummy',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        url: PAGE,
        gitSha: 'abc1234',
        attemptId,
      }),
    }),
  );
}

describe('POST /api/v1/live-lock security', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mocks.authenticateApiKey.mockResolvedValue({
      id: 'key-1',
      organizationId: 'org-1',
      plan: 'pro',
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('does not fetch the target when ownership is not verified', async () => {
    const fetchImpl = vi.fn();
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    mocks.getAdminDbAdapter.mockReturnValue(dbFor(target(false)));

    const res = await call('unverified');
    expect(res.status).toBe(200);
    expect((await res.json()).reason).toBe('ownership_unverified');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads a verified URL with GET or HEAD only', async () => {
    const methods: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      methods.push(method);
      const url = String(input);
      if (url.startsWith('https://myapp.example')) {
        return new Response('<html><body>ok</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;

    const db = dbFor(target(true));
    mocks.getAdminDbAdapter.mockReturnValue(db);

    const res = await call('verified-read');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.every((method) => method === 'GET' || method === 'HEAD')).toBe(true);
  });

  it('returns the same row for a repeated attempt id without probing again', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response('<html><body>ok</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    mocks.getAdminDbAdapter.mockReturnValue(dbFor(target(true)));

    const first = await call('same-attempt');
    const firstBody = await first.json();
    const callsAfterFirst = fetchImpl.mock.calls.length;
    const second = await call('same-attempt');
    expect(first.status).toBe(200);
    expect(await second.json()).toMatchObject(firstBody);
    expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst);
  });
});
