import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  getAdminDbAdapter: vi.fn(),
  register: vi.fn(),
  start: vi.fn(),
  rerun: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}));
vi.mock('../../../../../utils/dbAdapter', () => ({
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));
vi.mock('../../../../../utils/liveLockDeploymentCheck', () => ({
  registerDeploymentCheck: mocks.register,
  startDeploymentCheck: mocks.start,
  rerunDeploymentCheck: mocks.rerun,
}));

import { POST } from './route';
import { resetRateLimitsForTests } from '../../../../../utils/rateLimit';

const SECRET = 'integration-client-secret';
const db = { removeVercelConnection: vi.fn() };

function sign(body: string, secret = SECRET): string {
  return crypto.createHmac('sha1', secret).update(body).digest('hex');
}

function deploymentEvent(type: string): string {
  return JSON.stringify({
    type,
    payload: {
      deployment: { id: 'dpl_abc', url: 'app-abc.vercel.app', meta: {} },
      project: { id: 'prj_app' },
      team: { id: 'team_1' },
      target: 'production',
    },
  });
}

function request(body: string, signature: string | null = sign(body)): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature) headers['x-vercel-signature'] = signature;
  return new Request('http://localhost/api/vercel/integration/webhook', {
    method: 'POST',
    headers,
    body,
  });
}

describe('Vercel integration webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    process.env.VERCEL_INTEGRATION_CLIENT_SECRET = SECRET;
    process.env.APP_URL = 'https://assurly.dev';
    mocks.getAdminDbAdapter.mockReturnValue(db);
  });

  it('fails closed when the integration secret is absent', async () => {
    delete process.env.VERCEL_INTEGRATION_CLIENT_SECRET;
    expect((await POST(request(deploymentEvent('deployment.created')))).status).toBe(503);
    expect(mocks.getAdminDbAdapter).not.toHaveBeenCalled();
  });

  it('rejects a bad or missing signature before any lookup', async () => {
    const body = deploymentEvent('deployment.created');
    expect((await POST(request(body, sign(body, 'wrong')))).status).toBe(401);
    expect((await POST(request(body, null))).status).toBe(401);
    expect(mocks.getAdminDbAdapter).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('registers the check inline on deployment.created', async () => {
    mocks.register.mockResolvedValue({ deployment_id: 'dpl_abc' });
    const response = await POST(request(deploymentEvent('deployment.created')));
    expect(response.status).toBe(200);
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: 'dpl_abc', projectId: 'prj_app', production: true }),
      expect.anything(),
    );
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('answers within the delivery window and probes in the background on ready', async () => {
    const run = vi.fn(async () => undefined);
    mocks.start.mockResolvedValue(run);
    const response = await POST(request(deploymentEvent('deployment.ready')));
    expect(response.status).toBe(202);
    expect(run).not.toHaveBeenCalled();
    const background = mocks.after.mock.calls[0]?.[0] as () => Promise<void>;
    await background();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does nothing when another delivery already holds the run', async () => {
    mocks.start.mockResolvedValue(null);
    const response = await POST(request(deploymentEvent('deployment.ready')));
    expect(response.status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('drops the connection when the integration is removed', async () => {
    const body = JSON.stringify({
      type: 'integration-configuration.removed',
      payload: { configuration: { id: 'icfg_abc' } },
    });
    expect((await POST(request(body))).status).toBe(200);
    expect(db.removeVercelConnection).toHaveBeenCalledWith('icfg_abc');
  });

  it('ignores events it does not handle', async () => {
    const body = JSON.stringify({ type: 'project.created', payload: {} });
    expect((await POST(request(body))).status).toBe(200);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
