import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAdminDbAdapter: vi.fn(),
  runGuardianBatch: vi.fn(),
}));

vi.mock('../../../../utils/dbAdapter', () => ({
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));
vi.mock('../../../../utils/guardian', () => ({
  runGuardianBatch: mocks.runGuardianBatch,
}));

import { GET } from './route';
import { resetRateLimitsForTests } from '../../../../utils/rateLimit';

const SECRET = 'cron-test-secret';

function request(authorization?: string | null): Request {
  const headers: Record<string, string> = {};
  if (authorization !== null && authorization !== undefined) {
    headers.authorization = authorization;
  }
  return new Request('http://localhost/api/cron/guardian', { method: 'GET', headers });
}

describe('GET /api/cron/guardian', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    process.env.CRON_SECRET = SECRET;
    mocks.getAdminDbAdapter.mockReturnValue({ listVerifiedUrlTargets: vi.fn() });
    mocks.runGuardianBatch.mockResolvedValue({
      checked: 1,
      skipped: 0,
      alerted: 0,
      errors: 0,
      timedOut: false,
      results: [],
    });
  });

  it('uses an unauthenticated webhook rate limit', () => {
    expect(GET.security.routeId).toBe('cron:guardian');
    expect(GET.security.auth).toBe('none');
    expect(GET.security.rateLimit).toEqual({ limit: 300, windowSeconds: 60 });
  });

  it('returns 401 and never probes when the secret is missing', async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(401);
    expect(mocks.getAdminDbAdapter).not.toHaveBeenCalled();
    expect(mocks.runGuardianBatch).not.toHaveBeenCalled();
  });

  it('returns 401 and never probes when the Authorization header is invalid', async () => {
    const response = await GET(request('Bearer wrong'));
    expect(response.status).toBe(401);
    expect(mocks.getAdminDbAdapter).not.toHaveBeenCalled();
    expect(mocks.runGuardianBatch).not.toHaveBeenCalled();
  });

  it('returns 401 and never probes when the Authorization header is absent', async () => {
    const response = await GET(request(null));
    expect(response.status).toBe(401);
    expect(mocks.getAdminDbAdapter).not.toHaveBeenCalled();
    expect(mocks.runGuardianBatch).not.toHaveBeenCalled();
  });

  it('runs the guardian batch when the shared secret is valid', async () => {
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(mocks.getAdminDbAdapter).toHaveBeenCalledOnce();
    expect(mocks.runGuardianBatch).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      checked: 1,
      alerted: 0,
      timedOut: false,
    });
  });
});
