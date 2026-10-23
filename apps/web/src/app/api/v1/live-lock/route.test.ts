import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  getAdminDbAdapter: vi.fn(),
  runLiveLock: vi.fn(),
}));

vi.mock('../../../../utils/apiKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/apiKeys')>()),
  authenticateApiKey: mocks.authenticateApiKey,
}));
vi.mock('../../../../utils/dbAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/dbAdapter')>()),
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));
vi.mock('../../../../utils/liveLock', () => ({
  runLiveLock: mocks.runLiveLock,
}));

import { POST } from './route';
import { resetRateLimitsForTests } from '../../../../utils/rateLimit';
import type { Target } from '../../../../utils/dbAdapter';

function target(overrides: Partial<Target> = {}): Target {
  return {
    id: 'target-1',
    organization_id: 'org-1',
    kind: 'url',
    identifier: 'https://app.example.com',
    display_name: 'Example',
    repository_id: null,
    generator_fingerprint: null,
    ownership_verified: true,
    ownership_method: 'dns_txt',
    current_verdict: 'blocked',
    current_ship_score: 59,
    verdict_evidence: null,
    last_checked_at: null,
    badge_token: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function call(body: unknown): Promise<Response> {
  return POST(
    new Request('http://localhost/api/v1/live-lock', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ask_live_dummy',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/v1/live-lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mocks.authenticateApiKey.mockResolvedValue({
      id: 'key-1',
      organizationId: 'org-1',
      plan: 'pro',
    });
  });

  it('rejects a preview URL field so the public body cannot choose the host', async () => {
    mocks.getAdminDbAdapter.mockReturnValue({ getTargetByIdentifier: vi.fn() });
    const res = await call({
      url: 'https://app.example.com',
      gitSha: 'abc1234',
      attemptId: 'run-1',
      previewUrl: 'https://stranger.vercel.app',
    });
    expect(res.status).toBe(400);
    expect(mocks.runLiveLock).not.toHaveBeenCalled();
  });

  it('returns 404 and does not probe when the URL is not a guarded target', async () => {
    const getTargetByIdentifier = vi.fn().mockResolvedValue(null);
    mocks.getAdminDbAdapter.mockReturnValue({ getTargetByIdentifier });
    const res = await call({
      url: 'https://stranger.example.com',
      gitSha: 'abc1234',
      attemptId: 'run-1',
    });
    expect(res.status).toBe(404);
    expect(mocks.runLiveLock).not.toHaveBeenCalled();
  });

  it('returns the fresh blocked verdict and a capped score', async () => {
    const row = target();
    mocks.getAdminDbAdapter.mockReturnValue({
      getTargetByIdentifier: vi.fn().mockResolvedValue(row),
    });
    mocks.runLiveLock.mockResolvedValue({
      status: 'blocked',
      shipScore: 59,
      reason: 'runtime_blocker',
      gitSha: 'abc1234',
      attemptId: 'run-1',
      checkedAt: '2026-10-23T12:00:00.000Z',
      fresh: true,
    });
    const res = await call({
      url: 'https://app.example.com/path',
      gitSha: 'ABC1234',
      attemptId: 'run-1',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'blocked',
      shipScore: 59,
      reason: 'runtime_blocker',
      gitSha: 'abc1234',
      attemptId: 'run-1',
      checkedAt: '2026-10-23T12:00:00.000Z',
    });
    expect(mocks.runLiveLock).toHaveBeenCalledWith(
      expect.objectContaining({
        target: row,
        gitSha: 'abc1234',
        attemptId: 'run-1',
      }),
    );
  });

  it('rejects a missing key', async () => {
    mocks.authenticateApiKey.mockResolvedValue(null);
    mocks.getAdminDbAdapter.mockReturnValue({ getTargetByIdentifier: vi.fn() });
    const res = await call({
      url: 'https://app.example.com',
      gitSha: 'abc1234',
      attemptId: 'run-1',
    });
    expect(res.status).toBe(401);
    expect(mocks.runLiveLock).not.toHaveBeenCalled();
  });
});
