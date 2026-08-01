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
      { activeProbe: false, organizationId: undefined, visibilityAudit: true },
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
      { activeProbe: true, organizationId: 'org-1', visibilityAudit: true },
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
      ownership_verified: true,
      identifier: 'https://custom.example.com',
    });
    const getTargetByIdentifier = vi.fn().mockResolvedValue({
      id: 'target-1',
      ownership_verified: true,
      identifier: 'https://custom.example.com',
    });
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: {
        getOrganizationByUserId,
        insertProbeEvidence: vi.fn(),
        upsertTarget,
        getTargetByIdentifier,
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
    // Verdict projection only — never write generatorFingerprint: 'unknown'.
    expect(upsertTarget).toHaveBeenCalled();
    for (const [payload] of upsertTarget.mock.calls) {
      expect(payload).not.toHaveProperty('generatorFingerprint');
    }
    expect(upsertTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        currentVerdict: 'ready',
        currentShipScore: 100,
        lastCheckedAt: expect.any(String),
      }),
    );
  });

  it('does NOT create a target for a one-off authenticated scan (no existing URL target)', async () => {
    const insertProbeEvidence = vi.fn().mockResolvedValue(undefined);
    const getOrganizationByUserId = vi
      .fn()
      .mockResolvedValue({ id: 'org-1', billing_plan: 'free' });
    const upsertTarget = vi.fn();
    const getTargetByIdentifier = vi.fn().mockResolvedValue(null);
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: {
        getOrganizationByUserId,
        insertProbeEvidence,
        upsertTarget,
        getTargetByIdentifier,
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
    // One-off probes stay passive and never pollute Your apps.
    expect(scanLiveUrlMock).toHaveBeenCalledWith(
      'https://not-mine.lovable.app/',
      expect.anything(),
      undefined,
      { activeProbe: false, organizationId: 'org-1', visibilityAudit: true },
    );
    expect(json.target).toBeNull();
    expect(upsertTarget).not.toHaveBeenCalled();
  });

  it('attaches an existing UNVERIFIED guarded URL without running the active probe', async () => {
    const insertProbeEvidence = vi.fn().mockResolvedValue(undefined);
    const getOrganizationByUserId = vi
      .fn()
      .mockResolvedValue({ id: 'org-1', billing_plan: 'free' });
    const upsertTarget = vi.fn().mockResolvedValue({
      id: 'target-1',
      ownership_verified: false,
      identifier: 'https://pending.lovable.app',
    });
    const getTargetByIdentifier = vi.fn().mockResolvedValue({
      id: 'target-1',
      ownership_verified: false,
      identifier: 'https://pending.lovable.app',
    });
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: {
        getOrganizationByUserId,
        insertProbeEvidence,
        upsertTarget,
        getTargetByIdentifier,
      },
    });

    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://pending.lovable.app' }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(scanLiveUrlMock).toHaveBeenCalledWith(
      'https://pending.lovable.app/',
      expect.anything(),
      undefined,
      { activeProbe: false, organizationId: 'org-1', visibilityAudit: true },
    );
    expect(json.target).toEqual({ id: 'target-1', ownershipVerified: false });
    expect(upsertTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        kind: 'url',
        identifier: 'https://pending.lovable.app',
        currentVerdict: expect.any(String),
        currentShipScore: expect.any(Number),
        lastCheckedAt: expect.any(String),
      }),
    );
  });

  it('lets Pro scan a brand-new URL without creating a target (guard is a separate action)', async () => {
    const getOrganizationByUserId = vi.fn().mockResolvedValue({ id: 'org-1', billing_plan: 'pro' });
    const getTargetByIdentifier = vi.fn().mockResolvedValue(null);
    const upsertTarget = vi.fn();
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: {
        getOrganizationByUserId,
        getTargetByIdentifier,
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
    expect((await response.json()).target).toBeNull();
    expect(upsertTarget).not.toHaveBeenCalled();
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
      { activeProbe: false, organizationId: undefined, visibilityAudit: true },
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

  const fullVisibilityReport = {
    score: 42,
    aiReadinessScore: 30,
    searchReadinessScore: 55,
    verdict: 'invisible' as const,
    checks: [
      {
        id: 'ai-llms-txt',
        title: 'llms.txt is published',
        group: 'ai' as const,
        status: 'fail' as const,
        detail: 'llms.txt is absent or empty.',
        fix: 'Serve /llms.txt with a clear site summary.',
      },
    ],
  };

  it('entitled (pro) response carries the full visibility check array', async () => {
    const getOrganizationByUserId = vi.fn().mockResolvedValue({ id: 'org-1', billing_plan: 'pro' });
    const upsertTarget = vi.fn().mockResolvedValue({ id: 'target-1', ownership_verified: false });
    const getTargetByIdentifier = vi.fn().mockResolvedValue(null);
    const getTargets = vi.fn().mockResolvedValue([]);
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: {
        getOrganizationByUserId,
        upsertTarget,
        getTargetByIdentifier,
        getTargets,
        insertProbeEvidence: vi.fn(),
      },
    });
    scanLiveUrlMock.mockResolvedValue({
      findings: [],
      evidence: [],
      pageText: '',
      visibility: fullVisibilityReport,
    });

    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://pro-app.example.com' }),
      }),
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;
    const serialized = JSON.stringify(json);
    expect(json.visibility).toEqual(fullVisibilityReport);
    expect(serialized).toContain('"checks"');
    expect(json.visibilityLocked).toBeUndefined();
  });

  it('unentitled (free) response carries scores and verdict but NO check array', async () => {
    const getOrganizationByUserId = vi
      .fn()
      .mockResolvedValue({ id: 'org-1', billing_plan: 'free' });
    const upsertTarget = vi.fn().mockResolvedValue({ id: 'target-1', ownership_verified: false });
    const getTargetByIdentifier = vi.fn().mockResolvedValue(null);
    const getTargets = vi.fn().mockResolvedValue([]);
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: {
        getOrganizationByUserId,
        upsertTarget,
        getTargetByIdentifier,
        getTargets,
        insertProbeEvidence: vi.fn(),
      },
    });
    scanLiveUrlMock.mockResolvedValue({
      findings: [],
      evidence: [],
      pageText: '',
      visibility: fullVisibilityReport,
    });

    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://free-app.example.com' }),
      }),
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      visibility: Record<string, unknown>;
      visibilityLocked?: boolean;
    };
    // Assert on the actual serialized JSON — not a component prop.
    const visibilityJson = JSON.stringify(json.visibility);
    expect(json.visibility).toEqual({
      score: 42,
      aiReadinessScore: 30,
      searchReadinessScore: 55,
      verdict: 'invisible',
    });
    expect(visibilityJson).not.toContain('"checks"');
    expect(json.visibility).not.toHaveProperty('checks');
    expect(json.visibilityLocked).toBe(true);
  });

  it('anonymous response also withholds checks and sets visibilityLocked', async () => {
    scanLiveUrlMock.mockResolvedValue({
      findings: [],
      evidence: [],
      pageText: '',
      visibility: fullVisibilityReport,
    });

    const response = await POST(
      new Request('http://localhost/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://anon-app.example.com' }),
      }),
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      visibility: Record<string, unknown>;
      visibilityLocked?: boolean;
    };
    expect(json.visibility).not.toHaveProperty('checks');
    expect(json.visibilityLocked).toBe(true);
    expect(json.visibility.verdict).toBe('invisible');
    expect(json.visibility.score).toBe(42);
  });
});
