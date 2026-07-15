import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '../../../utils/auth';
import { resetRateLimitsForTests } from '../../../utils/rateLimit';
import { POST } from './route';

/**
 * End-to-end ownership-gate security test.
 *
 * Unlike route.test.ts (which mocks the scanner), this runs the REAL
 * `scanLiveUrlWithEvidence` so we prove the *entire* active path — planted
 * Supabase config → RLS row-pull — cannot execute against a `url` target unless
 * `ownership_verified = true`. DNS and HTTP are mocked so no real network is
 * touched; auth and the DB adapter are hand-built so only the scanner uses
 * global fetch.
 */

const requireUserMock = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/auth')>();
  return { ...actual, requireUser: requireUserMock };
});

// Keep the SSRF host-resolution fully offline and public so safeFetch proceeds.
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
    };</script>
  </head><body>app</body></html>`;
}

/** Records every Supabase REST request the scanner attempts. */
function buildFetchMock(restRequests: string[]) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === PAGE_URL) {
      return new Response(plantedHtml(), { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('/rest/v1/')) {
      restRequests.push(url);
      return new Response(JSON.stringify([{ email: 'alice@example.com' }]), {
        status: 200,
        headers: { 'content-range': '0-0/500' },
      });
    }
    return new Response('', { status: 200 });
  }) as unknown as typeof fetch;
}

function authWithTarget(ownershipVerified: boolean) {
  return {
    user: { id: 'user-1' },
    accessToken: 'token',
    db: {
      getOrganizationByUserId: vi.fn().mockResolvedValue({ id: 'org-1', billing_plan: 'free' }),
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

describe('scan-url ownership gate (security)', () => {
  beforeEach(() => {
    resetRateLimitsForTests();
    requireUserMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('NEVER runs the active Supabase RLS row-pull for an UNVERIFIED url target', async () => {
    const restRequests: string[] = [];
    vi.stubGlobal('fetch', buildFetchMock(restRequests));
    requireUserMock.mockResolvedValue(authWithTarget(false));

    const response = await POST(scanRequest());
    expect(response.status).toBe(200);
    const json = await response.json();

    // Hard proof: the scanner made ZERO calls to the Supabase REST API...
    expect(restRequests).toEqual([]);
    // ...and no RLS finding / evidence could have been produced.
    expect(
      json.findings.some((f: { ruleId: string }) => f.ruleId === 'runtime-supabase-rls-open'),
    ).toBe(false);
    expect(json.evidence.some((e: { kind: string }) => e.kind === 'rls_rows')).toBe(false);
    expect(json.target).toEqual({ id: 'target-1', ownershipVerified: false });
  });

  it('runs the active RLS row-pull once the url target IS ownership-verified', async () => {
    const restRequests: string[] = [];
    vi.stubGlobal('fetch', buildFetchMock(restRequests));
    requireUserMock.mockResolvedValue(authWithTarget(true));

    const response = await POST(scanRequest());
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(restRequests.length).toBeGreaterThan(0);
    expect(restRequests.every((u) => u.startsWith(`${SUPABASE_URL}/rest/v1/`))).toBe(true);
    expect(
      json.findings.some((f: { ruleId: string }) => f.ruleId === 'runtime-supabase-rls-open'),
    ).toBe(true);
    expect(json.target).toEqual({ id: 'target-1', ownershipVerified: true });
  });

  it('stays passive-only for an anonymous caller (no auth, no target)', async () => {
    const restRequests: string[] = [];
    vi.stubGlobal('fetch', buildFetchMock(restRequests));
    requireUserMock.mockRejectedValue(new AuthenticationError());

    const response = await POST(scanRequest());
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(restRequests).toEqual([]);
    expect(json.target).toBeNull();
  });
});
