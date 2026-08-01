import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { clearAiCache } from '../../../utils/ai/claudeClient';
import { AuthenticationError } from '../../../utils/auth';
import { resetRateLimitsForTests } from '../../../utils/rateLimit';
import { POST } from './route';

/**
 * End-to-end ownership-gate security test.
 *
 * Unlike route.test.ts (which mocks the scanner), this runs the REAL
 * `scanLiveUrlWithEvidence` so we prove the *entire* active path — planted
 * Supabase config → AI red-team planner → RLS row-pull — cannot execute against
 * a `url` target unless `ownership_verified = true`. DNS and HTTP are mocked so
 * no real network is touched; auth and the DB adapter are hand-built so only the
 * scanner uses global fetch.
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
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
/** Distinctive marker from `buildPlannerSystemPrompt` — identifies a planner call. */
const PLANNER_PROMPT_MARKER = 'red-team probe planner';

function plantedHtml(): string {
  return `<html><head>
    <script>window.__ENV = {
      NEXT_PUBLIC_SUPABASE_URL: "${SUPABASE_URL}",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "${makeAnonJwt()}"
    };</script>
  </head><body>app</body></html>`;
}

/**
 * Records every Supabase REST request the scanner attempts, and every red-team
 * planner call to the Claude API (so a test can prove the LLM is not even
 * consulted for an unverified target).
 */
function buildFetchMock(restRequests: string[], plannerCalls: string[] = []) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === PAGE_URL) {
      return new Response(plantedHtml(), { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url === ANTHROPIC_API_URL) {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes(PLANNER_PROMPT_MARKER)) plannerCalls.push(body);
      // Empty plan → the planner falls back to the deterministic table list, so
      // the active path still behaves exactly as it does without AI.
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
      getOrganizationByUserId: vi.fn().mockResolvedValue({ id: 'org-1', billing_plan: 'free' }),
      getTargetByIdentifier: vi.fn().mockResolvedValue({
        id: 'target-1',
        ownership_verified: ownershipVerified,
        identifier: PAGE_URL.replace(/\/$/, ''),
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

describe('scan-url ownership gate (security)', () => {
  beforeEach(() => {
    resetRateLimitsForTests();
    requireUserMock.mockReset();
    // Both planner tests scan the same page, so their prompts hash identically —
    // a leaked cache entry would mask a real fetch and make the positive control
    // pass for the wrong reason.
    clearAiCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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

  /**
   * The planner deliberately does not re-check ownership (see the docstring on
   * `planRedTeamProbes`) — it is safe only because it lives inside the
   * `options.activeProbe` branch that the gate guards. That makes the property
   * NON-LOCAL: hoisting the planner out of the branch (e.g. to "plan early")
   * would silently break it with every other test still green. These two pin the
   * boundary at the route level so such a refactor fails loudly.
   */
  it('NEVER consults the AI red-team planner for an UNVERIFIED url target', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const restRequests: string[] = [];
    const plannerCalls: string[] = [];
    vi.stubGlobal('fetch', buildFetchMock(restRequests, plannerCalls));
    requireUserMock.mockResolvedValue(authWithTarget(false));

    const response = await POST(scanRequest());
    expect(response.status).toBe(200);

    // The LLM is not merely ignored — it is never asked. No tokens are spent,
    // and no content scanned from an unproven target is sent to a third party.
    expect(plannerCalls).toEqual([]);
    expect(restRequests).toEqual([]);
  });

  it('consults the planner once the url target IS ownership-verified (positive control)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const restRequests: string[] = [];
    const plannerCalls: string[] = [];
    vi.stubGlobal('fetch', buildFetchMock(restRequests, plannerCalls));
    requireUserMock.mockResolvedValue(authWithTarget(true));

    const response = await POST(scanRequest());
    expect(response.status).toBe(200);

    // Proves the assertion above is not vacuous: with the SAME key, page, and
    // planted config, the only difference is `ownership_verified` — so the empty
    // `plannerCalls` there is the gate working, not a mis-wired test.
    expect(plannerCalls).toHaveLength(1);
    expect(plannerCalls[0]).toContain(PLANNER_PROMPT_MARKER);
    expect(restRequests.length).toBeGreaterThan(0);
  });
});
