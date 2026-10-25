import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  upsert: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../../../../../../../utils/vercelMarketplaceToken', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../../../utils/vercelMarketplaceToken')>()),
  verifyMarketplaceToken: mocks.verify,
}));
vi.mock('../../../../../../../utils/vercelMarketplace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../../../utils/vercelMarketplace')>()),
  upsertInstallation: mocks.upsert,
  getInstallation: mocks.get,
  updateInstallationPlan: mocks.update,
  deleteInstallation: mocks.remove,
}));
vi.mock('../../../../../../../utils/dbAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../../../utils/dbAdapter')>()),
  getAdminDbAdapter: () => ({}),
}));

import { DELETE, GET, PATCH, PUT } from './route';
import { MarketplaceAuthError } from '../../../../../../../utils/vercelMarketplaceToken';
import { MarketplaceError } from '../../../../../../../utils/vercelMarketplace';
import { resetRateLimitsForTests } from '../../../../../../../utils/rateLimit';

const INSTALLATION = 'icfg_abc123';

function caller(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'user',
    installationId: INSTALLATION,
    accountId: 'acc_1',
    userId: 'user_1',
    userRole: 'ADMIN',
    verifiedEmail: null,
    userName: null,
    ...overrides,
  };
}

function call(
  handler: typeof PUT,
  method: string,
  options: { body?: unknown; token?: string | null; installationId?: string } = {},
) {
  const installationId = options.installationId ?? INSTALLATION;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token !== null) headers.authorization = `Bearer ${options.token ?? 'h.p.s'}`;
  return handler(
    new Request(`https://assurly.test/api/vercel/marketplace/v1/installations/${installationId}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { params: Promise.resolve({ installationId }) },
  );
}

const upsertBody = {
  scopes: [],
  acceptedPolicies: {},
  credentials: { access_token: 'tok', token_type: 'Bearer' },
};

describe('Partner API installation route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    vi.stubEnv('VERCEL_INTEGRATION_CLIENT_ID', 'oac_test');
    vi.stubEnv('VERCEL_INTEGRATION_CLIENT_SECRET', 'secret');
    vi.stubEnv('VERCEL_INTEGRATION_SLUG', 'assurly');
    vi.stubEnv('VERCEL_TOKEN_KEY', Buffer.alloc(32, 1).toString('base64'));
    mocks.verify.mockResolvedValue(caller());
  });

  it('installs with a valid admin token', async () => {
    const res = await call(PUT, 'PUT', { body: upsertBody });
    expect(res.status).toBe(204);
    expect(mocks.verify).toHaveBeenCalledWith('h.p.s', { clientId: 'oac_test' });
    expect(mocks.upsert).toHaveBeenCalledWith(
      INSTALLATION,
      'acc_1',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('rejects a request without a token', async () => {
    expect((await call(GET, 'GET', { token: null })).status).toBe(401);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('rejects a token Vercel did not sign', async () => {
    mocks.verify.mockRejectedValueOnce(new MarketplaceAuthError('bad signature'));
    expect((await call(GET, 'GET')).status).toBe(401);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('never lets one installation act on another', async () => {
    mocks.verify.mockResolvedValueOnce(caller({ installationId: 'icfg_other' }));
    expect((await call(DELETE, 'DELETE')).status).toBe(403);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('a read-only team member cannot change the plan or uninstall', async () => {
    mocks.verify.mockResolvedValue(caller({ userRole: 'USER' }));
    expect((await call(PATCH, 'PATCH', { body: { billingPlanId: 'pro' } })).status).toBe(403);
    expect((await call(DELETE, 'DELETE')).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
    // Reading is fine.
    mocks.get.mockResolvedValueOnce({ billingPlan: { id: 'free' } });
    expect((await call(GET, 'GET')).status).toBe(200);
  });

  it('a system token may uninstall (Vercel cleans up a deleted account)', async () => {
    mocks.verify.mockResolvedValueOnce(caller({ kind: 'system', userId: null, userRole: null }));
    mocks.remove.mockResolvedValueOnce({ finalized: true });
    const res = await call(DELETE, 'DELETE');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ finalized: true });
  });

  it('answers a bad body in Vercel error format', async () => {
    const res = await call(PUT, 'PUT', { body: { scopes: 'nope' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation_error');
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('passes a domain error through with its user message', async () => {
    mocks.update.mockRejectedValueOnce(
      new MarketplaceError(400, 'validation_error', 'Unknown billing plan.', 'Pick a plan.'),
    );
    const res = await call(PATCH, 'PATCH', { body: { billingPlanId: 'gold' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: 'validation_error',
        message: 'Unknown billing plan.',
        user: { message: 'Pick a plan.' },
      },
    });
  });

  it('rejects a malformed installation id before verifying anything', async () => {
    expect((await call(GET, 'GET', { installationId: 'icfg_../x' })).status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('is unavailable until the integration is configured', async () => {
    vi.stubEnv('VERCEL_INTEGRATION_CLIENT_ID', '');
    expect((await call(GET, 'GET')).status).toBe(503);
  });
});
