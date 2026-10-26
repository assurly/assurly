import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(), getAdminDbAdapter: vi.fn(() => ({})) }));

vi.mock('../../../../utils/dbAdapter', () => ({ getAdminDbAdapter: mocks.getAdminDbAdapter }));
vi.mock('../../../../utils/vercelBillingRun', () => ({ runVercelBilling: mocks.run }));

import { GET } from './route';
import { resetRateLimitsForTests } from '../../../../utils/rateLimit';

const SECRET = 'cron-test-secret';

function call(authorization?: string) {
  return GET(
    new Request('http://localhost/api/cron/vercel-billing', {
      headers: authorization ? { authorization } : {},
    }),
  );
}

describe('GET /api/cron/vercel-billing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    process.env.CRON_SECRET = SECRET;
    mocks.run.mockResolvedValue({
      installations: 2,
      reported: 2,
      settled: 2,
      unsettled: 0,
      purged: 0,
      failed: 0,
    });
  });

  it('runs billing with the cron secret and returns the report', async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ installations: 2, failed: 0 });
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it('does nothing without the secret or with a wrong one', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong')).status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.getAdminDbAdapter).not.toHaveBeenCalled();
  });

  it('is scheduled in vercel.json', () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
      crons: { path: string; schedule: string }[];
    };
    expect(config.crons).toContainEqual(
      expect.objectContaining({ path: '/api/cron/vercel-billing' }),
    );
  });
});
