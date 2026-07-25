import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { RATE_LIMITS } from '../../../utils/apiSecurity';
import { AuthenticationError } from '../../../utils/auth';
import { resetRateLimitsForTests } from '../../../utils/rateLimit';
import { POST } from './route';

const scanLiveUrlMock = vi.hoisted(() => vi.fn());
const requireUserMock = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/runtimeScanner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/runtimeScanner')>();
  return {
    ...actual,
    scanLiveUrlWithEvidence: scanLiveUrlMock,
  };
});

vi.mock('../../../utils/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/auth')>();
  return {
    ...actual,
    requireUser: requireUserMock,
  };
});

describe('POST /api/scan-url', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetRateLimitsForTests();
    scanLiveUrlMock.mockReset();
    scanLiveUrlMock.mockResolvedValue({ findings: [], evidence: [], pageText: '' });
    requireUserMock.mockReset();
    // Default: anonymous caller (no session) → secureRoute treats optional auth as null.
    requireUserMock.mockRejectedValue(new AuthenticationError());
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('returns report and findings for a valid public URL', async () => {
    scanLiveUrlMock.mockResolvedValue({
      findings: [
        {
          ruleId: 'runtime-missing-security-headers',
          severity: 'warning',
          message: 'Missing security headers: Strict-Transport-Security.',
          file: 'HTTP response',
        },
      ],
      evidence: [],
    });

    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://myapp.lovable.app' }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.report).toMatchObject({
      status: 'review',
      headline: 'REVIEW RECOMMENDED',
      shipScore: expect.any(Number),
    });
    expect(json.findings).toHaveLength(1);
    expect(json.evidence).toEqual([]);
    // Anonymous callers get passive checks only (no active RLS row-pull).
    expect(scanLiveUrlMock).toHaveBeenCalledWith(
      'https://myapp.lovable.app/',
      expect.anything(),
      undefined,
      { activeProbe: false, organizationId: undefined },
    );
  });

  it('returns NOT READY TO SHIP when runtime RLS is open', async () => {
    scanLiveUrlMock.mockResolvedValue({
      findings: [
        {
          ruleId: 'runtime-supabase-rls-open',
          severity: 'error',
          message: "Supabase table 'profiles' returned rows via anon key without RLS protection.",
          file: 'Supabase REST API',
        },
      ],
      evidence: [],
    });

    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://myapp.lovable.app' }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.report).toMatchObject({
      status: 'blocked',
      headline: 'NOT READY TO SHIP',
    });
  });

  it('rejects localhost URLs with 400', async () => {
    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://localhost:3000' }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_url');
    expect(scanLiveUrlMock).not.toHaveBeenCalled();
  });

  it('rejects private IP URLs with 400', async () => {
    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://192.168.0.10' }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_url');
  });

  it('rejects non-http(s) URLs with 400', async () => {
    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'file:///tmp/app' }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_url');
  });

  it('rejects malformed URLs with 400', async () => {
    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: '::::' }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_url');
  });

  it('runs the active probe and persists evidence for an authenticated scan on a verified URL target', async () => {
    const insertProbeEvidence = vi.fn().mockResolvedValue(undefined);
    const getOrganizationByUserId = vi
      .fn()
      .mockResolvedValue({ id: 'org-1', billing_plan: 'free' });
    const upsertTarget = vi.fn().mockResolvedValue({ id: 'target-1', ownership_verified: true });
    // Re-scan of the already-guarded app (existing target) — within the free limit.
    const getTargetByIdentifier = vi
      .fn()
      .mockResolvedValue({ id: 'target-1', ownership_verified: true });
    const getTargets = vi.fn().mockResolvedValue([{ id: 'target-1' }]);
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: {
        getOrganizationByUserId,
        insertProbeEvidence,
        upsertTarget,
        getTargetByIdentifier,
        getTargets,
      },
    });
    scanLiveUrlMock.mockResolvedValue({
      findings: [
        {
          ruleId: 'runtime-supabase-rls-open',
          severity: 'error',
          message: "Supabase table 'users' returned rows via anon key without RLS protection.",
          file: 'Supabase REST API',
        },
      ],
      evidence: [
        {
          findingRuleId: 'runtime-supabase-rls-open',
          kind: 'rls_rows',
          summary: 'We read 500 rows from your `users` table using only the public key.',
          redactedSample: {
            table: 'users',
            rowCount: 500,
            columns: ['email'],
            sampleCell: 't***@***.com',
          },
        },
      ],
    });

    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://myapp.lovable.app' }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.evidence).toHaveLength(1);
    expect(scanLiveUrlMock).toHaveBeenCalledWith(
      'https://myapp.lovable.app/',
      expect.anything(),
      undefined,
      { activeProbe: true, organizationId: 'org-1' },
    );
    expect(insertProbeEvidence).toHaveBeenCalledWith([
      expect.objectContaining({
        organizationId: 'org-1',
        findingRuleId: 'runtime-supabase-rls-open',
        kind: 'rls_rows',
      }),
    ]);
    expect(json.target).toEqual({ id: 'target-1', ownershipVerified: true });
    expect(upsertTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        kind: 'url',
        identifier: 'https://myapp.lovable.app',
      }),
    );
  });

  it('persists a detected generator fingerprint on the url target after scan', async () => {
    const getOrganizationByUserId = vi
      .fn()
      .mockResolvedValue({ id: 'org-1', billing_plan: 'free' });
    const upsertTarget = vi.fn().mockResolvedValue({
      id: 'target-1',
      ownership_verified: true,
      identifier: 'https://myapp.lovable.app',
    });
    const getTargetByIdentifier = vi
      .fn()
      .mockResolvedValue({ id: 'target-1', ownership_verified: true });
    const getTargets = vi.fn().mockResolvedValue([{ id: 'target-1' }]);
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: {
        getOrganizationByUserId,
        insertProbeEvidence: vi.fn(),
        upsertTarget,
        getTargetByIdentifier,
        getTargets,
      },
    });
    scanLiveUrlMock.mockResolvedValue({
      findings: [],
      evidence: [],
      pageText: '<script src="https://cdn.gpteng.co/gptengineer.js"></script>',
    });

    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://myapp.lovable.app' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(upsertTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        kind: 'url',
        identifier: 'https://myapp.lovable.app',
        generatorFingerprint: 'lovable',
      }),
    );
    // pageText must never leak to the client response.
    const json = await response.json();
    expect(json).not.toHaveProperty('pageText');
    expect(JSON.stringify(json)).not.toContain('gpteng.co');
  });

  it('does not fabricate a generator fingerprint when detection is absent', async () => {
    const getOrganizationByUserId = vi
      .fn()
      .mockResolvedValue({ id: 'org-1', billing_plan: 'free' });
    const upsertTarget = vi.fn().mockResolvedValue({
      id: 'target-1',
      ownership_verified: false,
      identifier: 'https://custom.example.com',
    });
    const getTargetByIdentifier = vi.fn().mockResolvedValue(null);
    const getTargets = vi.fn().mockResolvedValue([]);
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: {
        getOrganizationByUserId,
        insertProbeEvidence: vi.fn(),
        upsertTarget,
        getTargetByIdentifier,
        getTargets,
      },
    });
    scanLiveUrlMock.mockResolvedValue({
      findings: [],
      evidence: [],
      pageText: '<html><body>Hello</body></html>',
    });

    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://custom.example.com' }),
      }),
    );

    expect(response.status).toBe(200);
    // Target creation upsert only — never write generatorFingerprint: 'unknown'.
    expect(upsertTarget).toHaveBeenCalledTimes(1);
    expect(upsertTarget.mock.calls[0][0]).not.toHaveProperty('generatorFingerprint');
  });

  it('does NOT run the active probe for an authenticated scan on an UNVERIFIED URL target', async () => {
    const insertProbeEvidence = vi.fn().mockResolvedValue(undefined);
    const getOrganizationByUserId = vi
      .fn()
      .mockResolvedValue({ id: 'org-1', billing_plan: 'free' });
    const upsertTarget = vi.fn().mockResolvedValue({ id: 'target-1', ownership_verified: false });
    // First guarded app for a free org (no existing target, zero currently) — allowed.
    const getTargetByIdentifier = vi.fn().mockResolvedValue(null);
    const getTargets = vi.fn().mockResolvedValue([]);
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: {
        getOrganizationByUserId,
        insertProbeEvidence,
        upsertTarget,
        getTargetByIdentifier,
        getTargets,
      },
    });

    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://not-mine.lovable.app' }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    // The gate must force passive-only for an unverified url target, even though
    // the caller is authenticated.
    expect(scanLiveUrlMock).toHaveBeenCalledWith(
      'https://not-mine.lovable.app/',
      expect.anything(),
      undefined,
      { activeProbe: false, organizationId: 'org-1' },
    );
    expect(json.target).toEqual({ id: 'target-1', ownershipVerified: false });
  });

  it('rejects guarding a NEW app past the free plan limit (server-side entitlement)', async () => {
    const getOrganizationByUserId = vi
      .fn()
      .mockResolvedValue({ id: 'org-1', billing_plan: 'free' });
    // No existing target for this URL, but the org already guards its one free app.
    const getTargetByIdentifier = vi.fn().mockResolvedValue(null);
    const getTargets = vi.fn().mockResolvedValue([{ id: 'existing-target' }]);
    const upsertTarget = vi.fn();
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: {
        getOrganizationByUserId,
        getTargetByIdentifier,
        getTargets,
        upsertTarget,
        insertProbeEvidence: vi.fn(),
      },
    });

    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://second-app.lovable.app' }),
      }),
    );

    expect(response.status).toBe(402);
    expect((await response.json()).error.code).toBe('plan_required');
    // The over-limit action is blocked before any target is created or scanned.
    expect(upsertTarget).not.toHaveBeenCalled();
    expect(scanLiveUrlMock).not.toHaveBeenCalled();
  });

  it('lets a Pro org guard a new app beyond one (unlimited guarded apps)', async () => {
    const getOrganizationByUserId = vi.fn().mockResolvedValue({ id: 'org-1', billing_plan: 'pro' });
    const getTargetByIdentifier = vi.fn().mockResolvedValue(null);
    const getTargets = vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const upsertTarget = vi.fn().mockResolvedValue({ id: 'target-9', ownership_verified: false });
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: {
        getOrganizationByUserId,
        getTargetByIdentifier,
        getTargets,
        upsertTarget,
        insertProbeEvidence: vi.fn(),
      },
    });

    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://nth-app.lovable.app' }),
      }),
    );

    expect(response.status).toBe(200);
    // Pro never consults getTargets for a limit — unlimited apps.
    expect(getTargets).not.toHaveBeenCalled();
    expect(upsertTarget).toHaveBeenCalled();
  });

  it('stays passive-only when the target lookup fails (fail-closed)', async () => {
    const getOrganizationByUserId = vi.fn().mockRejectedValue(new Error('db down'));
    const upsertTarget = vi.fn();
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: { getOrganizationByUserId, upsertTarget, insertProbeEvidence: vi.fn() },
    });

    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://myapp.lovable.app' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(scanLiveUrlMock).toHaveBeenCalledWith(
      'https://myapp.lovable.app/',
      expect.anything(),
      undefined,
      { activeProbe: false, organizationId: undefined },
    );
    expect(upsertTarget).not.toHaveBeenCalled();
  });

  it('uses the expensive rate limit policy', () => {
    expect(POST.security.rateLimit).toEqual(RATE_LIMITS.expensive);
  });

  it('returns 429 when the expensive rate limit is exceeded', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const allowed = await POST(
        new Request('http://localhost/api/scan-url', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '203.0.113.44',
          },
          body: JSON.stringify({ url: 'https://example.com' }),
        }),
      );
      expect(allowed.status).toBe(200);
    }

    const limited = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.44',
        },
        body: JSON.stringify({ url: 'https://example.com' }),
      }),
    );
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe('rate_limited');
  });

  it('never allows mutating HTTP methods through runtimeFetch', async () => {
    const { runtimeFetch } = await import('../../../utils/runtimeScanner');
    const fetchMock = vi.fn();
    await expect(runtimeFetch('https://example.com', { method: 'PUT' }, fetchMock)).rejects.toThrow(
      'Mutating HTTP method',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
