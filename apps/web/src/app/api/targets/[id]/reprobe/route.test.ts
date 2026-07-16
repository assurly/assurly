import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '../../../../../utils/auth';
import { resetRateLimitsForTests } from '../../../../../utils/rateLimit';
import { POST } from './route';

const requireUserMock = vi.hoisted(() => vi.fn());
const reprobeMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../../utils/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../utils/auth')>();
  return { ...actual, requireUser: requireUserMock };
});

vi.mock('../../../../../utils/reprobe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../utils/reprobe')>();
  return { ...actual, reprobeTargetAndRecord: reprobeMock };
});

const TARGET_ID = '11111111-1111-1111-1111-111111111111';

function urlTarget(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET_ID,
    organization_id: 'org-1',
    kind: 'url',
    identifier: 'https://app.example',
    generator_fingerprint: 'lovable',
    ownership_verified: true,
    ...overrides,
  };
}

function authWith(target: unknown) {
  return {
    user: { id: 'user-1' },
    accessToken: 'token',
    db: { getTargetById: vi.fn().mockResolvedValue(target) },
  };
}

function params() {
  return { params: Promise.resolve({ id: TARGET_ID }) };
}

function request() {
  return new Request(`http://localhost/api/targets/${TARGET_ID}/reprobe`, { method: 'POST' });
}

describe('/api/targets/[id]/reprobe', () => {
  beforeEach(() => {
    resetRateLimitsForTests();
    requireUserMock.mockReset();
    reprobeMock.mockReset();
  });

  it('returns 200 with the recorded outcomes after a verified re-probe', async () => {
    requireUserMock.mockResolvedValue(authWith(urlTarget()));
    reprobeMock.mockResolvedValue({
      activeProbe: true,
      probed: true,
      probeUrl: 'https://app.example',
      outcomes: [{ ruleId: 'runtime-supabase-rls-open', outcome: 'verified_fixed' }],
      findings: [],
      evidence: [],
    });

    const response = await POST(request(), params());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.probed).toBe(true);
    expect(json.outcomes).toEqual([
      { ruleId: 'runtime-supabase-rls-open', outcome: 'verified_fixed' },
    ]);
  });

  it('returns 403 for a url target that is not ownership-verified', async () => {
    requireUserMock.mockResolvedValue(authWith(urlTarget({ ownership_verified: false })));
    reprobeMock.mockResolvedValue({
      activeProbe: false,
      probed: false,
      probeUrl: 'https://app.example',
      outcomes: [],
      findings: [],
      evidence: [],
    });

    const response = await POST(request(), params());
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error.code).toBe('ownership_required');
  });

  it('returns 422 for a repo target that has no live URL to re-probe', async () => {
    requireUserMock.mockResolvedValue(authWith(urlTarget({ kind: 'repo', identifier: 'a/b' })));
    reprobeMock.mockResolvedValue({
      activeProbe: true,
      probed: false,
      probeUrl: null,
      outcomes: [],
      findings: [],
      evidence: [],
    });

    const response = await POST(request(), params());
    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.error.code).toBe('not_reprobeable');
  });

  it('returns 404 when the target is not found / not in the caller org', async () => {
    requireUserMock.mockResolvedValue(authWith(null));

    const response = await POST(request(), params());
    expect(response.status).toBe(404);
    expect(reprobeMock).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    requireUserMock.mockRejectedValue(new AuthenticationError());

    const response = await POST(request(), params());
    expect(response.status).toBe(401);
  });
});
