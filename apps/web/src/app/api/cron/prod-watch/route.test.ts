import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAdminDbAdapter: vi.fn(),
  runProdWatchBatch: vi.fn(),
  isProdWatchFeatureEnabled: vi.fn(() => true),
}));

vi.mock('../../../../utils/dbAdapter', () => ({
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));
vi.mock('../../../../utils/prodWatch', () => ({
  runProdWatchBatch: mocks.runProdWatchBatch,
  isProdWatchFeatureEnabled: mocks.isProdWatchFeatureEnabled,
}));

import { GET } from './route';
import { resetRateLimitsForTests } from '../../../../utils/rateLimit';

const SECRET = 'cron-prod-watch-secret';

function request(authorization?: string | null): Request {
  const headers: Record<string, string> = {};
  if (authorization !== null && authorization !== undefined) {
    headers.authorization = authorization;
  }
  return new Request('http://localhost/api/cron/prod-watch', { method: 'GET', headers });
}

describe('GET /api/cron/prod-watch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    process.env.CRON_SECRET = SECRET;
    mocks.isProdWatchFeatureEnabled.mockReturnValue(true);
    mocks.getAdminDbAdapter.mockReturnValue({});
    mocks.runProdWatchBatch.mockResolvedValue({
      checked: 1,
      skipped: 0,
      alerted: 0,
      errors: 0,
      timedOut: false,
      results: [],
    });
  });

  it('returns 401 and does no work when the cron secret is wrong', async () => {
    const response = await GET(request('Bearer wrong'));
    expect(response.status).toBe(401);
    expect(mocks.getAdminDbAdapter).not.toHaveBeenCalled();
    expect(mocks.runProdWatchBatch).not.toHaveBeenCalled();
  });

  it('short-circuits when the feature flag is off', async () => {
    mocks.isProdWatchFeatureEnabled.mockReturnValue(false);
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ enabled: false, checked: 0 });
    expect(mocks.runProdWatchBatch).not.toHaveBeenCalled();
  });

  it('runs the batch when authorised and enabled', async () => {
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(mocks.runProdWatchBatch).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({ enabled: true, checked: 1 });
  });
});
