import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '../../../utils/auth';
import { resetRateLimitsForTests } from '../../../utils/rateLimit';
import { clearAiCache } from '../../../utils/ai/claudeClient';
import { POST } from './route';

/**
 * End-to-end Phase 4 security test: ownership gate + AI planner rails.
 *
 * Proves:
 * 1. Unverified url targets never run the active probe OR the planner path
 *    (zero Supabase REST calls) — same boundary as Phase 3.
 * 2. Even when ownership is verified and callClaude returns adversarial JSON
 *    (mutating methods, raw URLs, unknown primitives), the executor never
 *    issues a mutating or out-of-scope request.
 * 3. With AI fully disabled, Layer 1 still returns a deterministic verdict.
 */

const requireUserMock = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/auth')>();
  return { ...actual, requireUser: requireUserMock };
});

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '203.0.113.10', family: 4 }]),
  resolveTxt: vi.fn(async () => []),
}));

function makeAnonJwt(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ role: 'anon', iss: 'supabase' })).toString('base64url');
  return `${header}.${body}.sig`;
}

const PAGE_URL = 'https://myapp.example/';
const SUPABASE_URL = 'https://demo.supabase.co';

function plantedHtml(): string {
  return `<html><head>
    <script>window.__ENV = {
      NEXT_PUBLIC_SUPABASE_URL: "${SUPABASE_URL}",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "${makeAnonJwt()}"
    };
    supabase.from('widgets').select();
    </script>
  </head><body>app</body></html>`;
}

function buildFetchMock(restRequests: Array<{ url: string; method: string }>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // Ignore Anthropic API — planner may call it when a key is set.
    if (url.includes('anthropic.com')) {
      return new Response(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: JSON.stringify([
                {
                  primitive: 'http_raw',
                  params: { method: 'DELETE', url: 'https://evil.example' },
                },
                {
                  primitive: 'supabase_rls_table_read',
                  params: { table: 'users', method: 'POST', url: 'https://evil.example' },
                },
                { primitive: 'supabase_rls_table_read', params: { table: 'widgets' } },
              ]),
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url === PAGE_URL) {
      return new Response(plantedHtml(), { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('/rest/v1/')) {
      restRequests.push({ url, method: (init?.method ?? 'GET').toUpperCase() });
      return new Response(JSON.stringify([{ email: 'alice@example.com' }]), {
        status: 200,
        headers: { 'content-range': '0-0/500' },
      });
    }
    return new Response('', { status: 200 });
  }) as unknown as typeof fetch;
}

function authWithTarget(ownershipVerified: boolean, billingPlan: 'free' | 'pro' = 'free') {
  return {
    user: { id: 'user-1' },
    accessToken: 'token',
    db: {
      getOrganizationByUserId: vi.fn().mockResolvedValue({
        id: 'org-1',
        billing_plan: billingPlan,
      }),
      upsertTarget: vi
        .fn()
        .mockResolvedValue({ id: 'target-1', ownership_verified: ownershipVerified }),
      insertProbeEvidence: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function scanRequest(): Request {
  return new Request('http://localhost/api/scan-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: PAGE_URL }),
  });
}

describe('scan-url AI planner + ownership gate (security)', () => {
  beforeEach(() => {
    resetRateLimitsForTests();
    requireUserMock.mockReset();
    clearAiCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('blocks planner + active probe when ownershipVerified is false', async () => {
    const restRequests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', buildFetchMock(restRequests));
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    requireUserMock.mockResolvedValue(authWithTarget(false));

    const response = await POST(scanRequest());
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(restRequests).toEqual([]);
    expect(
      json.findings.some((f: { ruleId: string }) => f.ruleId === 'runtime-supabase-rls-open'),
    ).toBe(false);
    expect(json.planSource).toBeUndefined();
    expect(json.target).toEqual({ id: 'target-1', ownershipVerified: false });
  });

  it('with AI adversarial output, only GET requests to the owned Supabase host are issued', async () => {
    const restRequests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', buildFetchMock(restRequests));
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    requireUserMock.mockResolvedValue(authWithTarget(true));

    const response = await POST(scanRequest());
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(restRequests.length).toBeGreaterThan(0);
    expect(restRequests.every((r) => r.method === 'GET')).toBe(true);
    expect(restRequests.every((r) => r.url.startsWith(`${SUPABASE_URL}/rest/v1/`))).toBe(true);
    expect(restRequests.some((r) => r.url.includes('evil.example'))).toBe(false);
    expect(
      json.findings.some((f: { ruleId: string }) => f.ruleId === 'runtime-supabase-rls-open'),
    ).toBe(true);
  });

  it('Layer 1 still returns a deterministic verdict with AI fully disabled', async () => {
    const restRequests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', buildFetchMock(restRequests));
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    requireUserMock.mockResolvedValue(authWithTarget(true));

    const response = await POST(scanRequest());
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.report).toBeDefined();
    expect(json.report.shipScore).toEqual(expect.any(Number));
    expect(json.planSource).toBe('deterministic');
    expect(restRequests.every((r) => r.method === 'GET')).toBe(true);
    expect(json.deepReview).toBeUndefined();
  });

  it('stays passive-only for anonymous callers', async () => {
    const restRequests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', buildFetchMock(restRequests));
    requireUserMock.mockRejectedValue(new AuthenticationError());

    const response = await POST(scanRequest());
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(restRequests).toEqual([]);
    expect(json.target).toBeNull();
  });

  it('locks deep review behind ownership for a Pro user on an unverified URL (no paid spend)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const restRequests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', buildFetchMock(restRequests));
    requireUserMock.mockResolvedValue(authWithTarget(false, 'pro'));

    const response = await POST(scanRequest());
    expect(response.status).toBe(200);
    const json = await response.json();

    // Passive scan → no active probe → deep review is NOT run (no Opus spend),
    // but the client is told it can unlock it by verifying ownership.
    expect(json.deepReview).toBeUndefined();
    expect(json.deepReviewLocked).toBe(true);
  });
});
