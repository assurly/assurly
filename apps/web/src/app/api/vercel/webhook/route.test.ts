import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  getAdminDbAdapter: vi.fn(),
  reprobe: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}));
vi.mock('../../../../utils/dbAdapter', () => ({
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));
vi.mock('../../../../utils/reprobe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/reprobe')>()),
  reprobeTargetAndRecord: mocks.reprobe,
}));

import { POST } from './route';
import { resetRateLimitsForTests } from '../../../../utils/rateLimit';

const SECRET = 'vercel-webhook-secret';

const db = {
  findVerifiedUrlTargetByOrigin: vi.fn(),
  claimVercelDelivery: vi.fn(),
  finishVercelDelivery: vi.fn(),
};

const target = {
  id: 'target-1',
  organization_id: 'org-1',
  kind: 'url' as const,
  identifier: 'https://myapp.vercel.app',
  generator_fingerprint: 'lovable',
  ownership_verified: true,
};

function sign(body: string, secret = SECRET): string {
  return crypto.createHmac('sha1', secret).update(body).digest('hex');
}

function eventBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'deployment.succeeded',
    payload: {
      deployment: { id: 'dpl_123', url: 'myapp.vercel.app' },
      url: 'myapp.vercel.app',
      target: 'production',
    },
    ...overrides,
  });
}

function request(body: string, signature?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const sig = signature ?? sign(body);
  if (sig) headers['x-vercel-signature'] = sig;
  return new Request('http://localhost/api/vercel/webhook', { method: 'POST', headers, body });
}

describe('Vercel webhook security and idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    process.env.VERCEL_WEBHOOK_SECRET = SECRET;
    mocks.getAdminDbAdapter.mockReturnValue(db);
    db.findVerifiedUrlTargetByOrigin.mockResolvedValue(target);
    db.claimVercelDelivery.mockResolvedValue(true);
    db.finishVercelDelivery.mockResolvedValue(undefined);
    mocks.reprobe.mockResolvedValue({
      activeProbe: true,
      probed: true,
      probeUrl: target.identifier,
      outcomes: [{ ruleId: 'runtime-supabase-rls-open', outcome: 'verified_fixed' }],
      findings: [],
      evidence: [],
    });
  });

  it('fails closed when the webhook secret is absent', async () => {
    delete process.env.VERCEL_WEBHOOK_SECRET;
    const body = eventBody();
    expect((await POST(request(body))).status).toBe(503);
    expect(mocks.getAdminDbAdapter).not.toHaveBeenCalled();
    expect(mocks.reprobe).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature with 401 before any DB access or probe', async () => {
    const body = eventBody();
    const response = await POST(request(body, sign(body, 'wrong-secret')));
    expect(response.status).toBe(401);
    expect(mocks.getAdminDbAdapter).not.toHaveBeenCalled();
    expect(mocks.reprobe).not.toHaveBeenCalled();
  });

  it('rejects an absent signature with 401 and never probes', async () => {
    const body = eventBody();
    const response = await POST(request(body, ''));
    expect(response.status).toBe(401);
    expect(mocks.getAdminDbAdapter).not.toHaveBeenCalled();
    expect(mocks.reprobe).not.toHaveBeenCalled();
  });

  it('ignores non-deploy events without touching the DB', async () => {
    const body = eventBody({ type: 'project.created' });
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(db.claimVercelDelivery).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('rejects a deploy event with an invalid deployment id', async () => {
    const body = eventBody({
      payload: { deployment: { id: 'bad id!' }, url: 'myapp.vercel.app' },
    });
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(db.claimVercelDelivery).not.toHaveBeenCalled();
  });

  it('never probes a payload target that does not match a verified app in our DB', async () => {
    db.findVerifiedUrlTargetByOrigin.mockResolvedValue(null);
    const body = eventBody({
      payload: { deployment: { id: 'dpl_evil', url: 'victim.com' }, url: 'victim.com' },
    });
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(db.claimVercelDelivery).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.reprobe).not.toHaveBeenCalled();
  });

  it('claims the deploy and re-probes the resolved target on a valid delivery', async () => {
    const body = eventBody();
    const response = await POST(request(body));
    expect(response.status).toBe(202);

    expect(db.findVerifiedUrlTargetByOrigin).toHaveBeenCalledWith('https://myapp.vercel.app');
    expect(db.claimVercelDelivery).toHaveBeenCalledWith(
      'dpl_123',
      'deployment.succeeded',
      'org-1',
      'target-1',
    );
    expect(mocks.after).toHaveBeenCalledOnce();

    const work = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await work();

    expect(mocks.reprobe).toHaveBeenCalledOnce();
    expect(mocks.reprobe).toHaveBeenCalledWith(
      expect.objectContaining({ target, deployId: 'dpl_123' }),
    );
    expect(db.finishVercelDelivery).toHaveBeenCalledWith('dpl_123', true);
  });

  it('writes exactly one outcome across a duplicate delivery (idempotent)', async () => {
    const body = eventBody();

    // First delivery is claimed → processed.
    expect((await POST(request(body))).status).toBe(202);
    const work = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await work();

    // Second (duplicate) delivery: the claim returns false → no processing.
    db.claimVercelDelivery.mockResolvedValue(false);
    const second = await POST(request(body));
    expect(second.status).toBe(200);

    // The re-probe (and therefore the fix_outcome write) ran exactly once.
    expect(mocks.reprobe).toHaveBeenCalledTimes(1);
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it('marks the delivery failed when the background re-probe throws', async () => {
    mocks.reprobe.mockRejectedValue(new Error('probe blew up'));
    const body = eventBody();
    expect((await POST(request(body))).status).toBe(202);
    const work = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await work();
    expect(db.finishVercelDelivery).toHaveBeenCalledWith('dpl_123', false, 'probe blew up');
  });
});
