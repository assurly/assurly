import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { clearAiCache } from '../../../../../utils/ai/claudeClient';
import { resetRateLimitsForTests } from '../../../../../utils/rateLimit';
import { POST } from './route';

/**
 * End-to-end ownership-gate security test for the on-demand re-probe.
 *
 * A re-probe IS an active probe. Like scan-url's ownershipGate.security.test.ts,
 * this runs the REAL `scanLiveUrlWithEvidence` so we prove the entire active path
 * — planted Supabase config → AI red-team planner → RLS row-pull — cannot execute
 * for a `url` target unless `ownership_verified = true`. We assert the SIDE EFFECT
 * (zero Supabase REST requests, zero planner calls), not just a response field: an
 * output-field assertion can pass while the real request already went out — that
 * exact gap was found in Phase 4.
 */

const requireUserMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../../utils/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../utils/auth')>();
  return { ...actual, requireUser: requireUserMock };
});

// Keep SSRF host-resolution fully offline and public so safeFetch proceeds.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '203.0.113.10', family: 4 }]),
  resolveTxt: vi.fn(async () => []),
}));

const TARGET_ID = '11111111-1111-1111-1111-111111111111';
const PAGE_URL = 'https://myapp.example/';
const SUPABASE_URL = 'https://demo.supabase.co';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
/** Distinctive marker from `buildPlannerSystemPrompt` — identifies a planner call. */
const PLANNER_PROMPT_MARKER = 'red-team probe planner';

function makeAnonJwt(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ role: 'anon', iss: 'supabase' })).toString('base64url');
  return `${header}.${body}.sig`;
}

function plantedHtml(): string {
  return `<html><head>
    <script>window.__ENV = {
      NEXT_PUBLIC_SUPABASE_URL: "${SUPABASE_URL}",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "${makeAnonJwt()}"
    };</script>
  </head><body>app</body></html>`;
}

function buildFetchMock(restRequests: string[], plannerCalls: string[] = []) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === PAGE_URL) {
      return new Response(plantedHtml(), { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url === ANTHROPIC_API_URL) {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes(PLANNER_PROMPT_MARKER)) plannerCalls.push(body);
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '[]' }] }), {
        status: 200,
      });
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
      getTargetById: vi.fn().mockResolvedValue({
        id: TARGET_ID,
        organization_id: 'org-1',
        kind: 'url',
        identifier: PAGE_URL,
        generator_fingerprint: 'lovable',
        ownership_verified: ownershipVerified,
      }),
      getFixOutcomesForTarget: vi.fn().mockResolvedValue([]),
      insertFixOutcomes: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function reprobeRequest(): Request {
  return new Request(`http://localhost/api/targets/${TARGET_ID}/reprobe`, { method: 'POST' });
}

function params() {
  return { params: Promise.resolve({ id: TARGET_ID }) };
}

describe('targets reprobe ownership gate (security)', () => {
  beforeEach(() => {
    resetRateLimitsForTests();
    requireUserMock.mockReset();
    clearAiCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('NEVER runs the active Supabase RLS row-pull for an UNVERIFIED url target', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const restRequests: string[] = [];
    const plannerCalls: string[] = [];
    vi.stubGlobal('fetch', buildFetchMock(restRequests, plannerCalls));
    const auth = authWithTarget(false);
    requireUserMock.mockResolvedValue(auth);

    const response = await POST(reprobeRequest(), params());

    // Fail closed: ownership not proven → 403, and NO active probe ran.
    expect(response.status).toBe(403);
    expect(restRequests).toEqual([]);
    expect(plannerCalls).toEqual([]);
    // Nothing recorded either — no verification happened.
    expect(auth.db.insertFixOutcomes).not.toHaveBeenCalled();
  });

  it('runs the active RLS row-pull once the url target IS ownership-verified (positive control)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const restRequests: string[] = [];
    const plannerCalls: string[] = [];
    vi.stubGlobal('fetch', buildFetchMock(restRequests, plannerCalls));
    const auth = authWithTarget(true);
    requireUserMock.mockResolvedValue(auth);

    const response = await POST(reprobeRequest(), params());

    // Proves the assertion above is not vacuous: same key, page, and planted
    // config; the only difference is `ownership_verified`.
    expect(response.status).toBe(200);
    expect(restRequests.length).toBeGreaterThan(0);
    expect(restRequests.every((u) => u.startsWith(`${SUPABASE_URL}/rest/v1/`))).toBe(true);
    expect(plannerCalls).toHaveLength(1);
    expect(auth.db.insertFixOutcomes).toHaveBeenCalledTimes(1);
  });
});
