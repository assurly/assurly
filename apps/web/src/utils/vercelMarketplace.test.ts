import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbAdapter, LiveLockResourceRow, VercelInstallationRow } from './dbAdapter';
import {
  deleteInstallation,
  deleteResource,
  getInstallation,
  MarketplaceError,
  provisionResource,
  updateInstallationPlan,
  updateResource,
  upsertInstallation,
  type MarketplaceDeps,
} from './vercelMarketplace';
import type { VercelMarketplaceApi } from './vercelMarketplaceApi';

const INSTALLATION = 'icfg_abc123';
const RESOURCE = '11111111-1111-4111-8111-111111111111';

function installation(plan: 'free' | 'pro' = 'free'): VercelInstallationRow {
  return {
    organization_id: 'org-1',
    account_id: 'acc_1',
    token_ciphertext: 'cipher',
    billing_plan_id: plan,
  };
}

function resource(overrides: Partial<LiveLockResourceRow> = {}): LiveLockResourceRow {
  return {
    resource_id: RESOURCE,
    installation_id: INSTALLATION,
    organization_id: 'org-1',
    name: 'Production',
    mode: 'monitor',
    status: 'ready',
    vercel_project_id: null,
    target_id: null,
    vercel_check_id: null,
    created_at: '2026-10-25T00:00:00Z',
    ...overrides,
  };
}

function setup() {
  const db = {
    upsertVercelInstallation: vi.fn(async () => 'org-1'),
    getVercelInstallation: vi.fn(async (): Promise<VercelInstallationRow | null> => installation()),
    setVercelInstallationPlan: vi.fn(async () => true),
    deleteVercelInstallation: vi.fn(async () => 'org-1'),
    createLiveLockResource: vi.fn(async (input: { name: string; mode: 'monitor' | 'enforce' }) =>
      resource({ name: input.name, mode: input.mode }),
    ),
    getLiveLockResource: vi.fn(async (): Promise<LiveLockResourceRow | null> => resource()),
    listLiveLockResources: vi.fn(async () => [] as LiveLockResourceRow[]),
    updateLiveLockResource: vi.fn(
      async (_installation: string, _resource: string, patch: Partial<LiveLockResourceRow>) =>
        resource(patch),
    ),
    deleteLiveLockResource: vi.fn(async () => undefined),
    setLiveLockMode: vi.fn(async () => null),
  };
  const api = {
    createProjectCheck: vi.fn(),
    setProjectCheckBlocking: vi.fn(async () => undefined),
    deleteProjectCheck: vi.fn(async () => undefined),
    updateCheckRun: vi.fn(),
    getDeployment: vi.fn(),
  } satisfies VercelMarketplaceApi;
  const deps: MarketplaceDeps = {
    db: db as unknown as DbAdapter,
    encryptToken: (plain) => `enc:${plain}`,
    decryptToken: (cipher) => `dec:${cipher}`,
    apiFor: vi.fn(() => api),
  };
  return { db, api, deps };
}

async function marketplaceError(promise: Promise<unknown>): Promise<MarketplaceError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(MarketplaceError);
  return error as MarketplaceError;
}

const upsertBody = {
  scopes: ['read:project'],
  acceptedPolicies: { toc: '2026-10-25T00:00:00Z' },
  credentials: { access_token: 'vercel-token', token_type: 'Bearer' },
  account: { name: 'Acme', url: 'https://vercel.com/acme', contact: { email: 'ops@acme.dev' } },
};

describe('installations', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('stores the token encrypted with the account details', async () => {
    await upsertInstallation(INSTALLATION, 'acc_1', upsertBody, ctx.deps);
    expect(ctx.db.upsertVercelInstallation).toHaveBeenCalledWith({
      installationId: INSTALLATION,
      accountId: 'acc_1',
      tokenCiphertext: 'enc:vercel-token',
      accountName: 'Acme',
      contactEmail: 'ops@acme.dev',
    });
    expect(ctx.db.setVercelInstallationPlan).not.toHaveBeenCalled();
  });

  it('records a plan chosen during install and ignores an unknown one', async () => {
    await upsertInstallation(
      INSTALLATION,
      'acc_1',
      { ...upsertBody, billingPlanId: 'pro' },
      ctx.deps,
    );
    expect(ctx.db.setVercelInstallationPlan).toHaveBeenCalledWith(INSTALLATION, 'pro');
    ctx.db.setVercelInstallationPlan.mockClear();
    await upsertInstallation(
      INSTALLATION,
      'acc_1',
      { ...upsertBody, billingPlanId: 'gold' },
      ctx.deps,
    );
    expect(ctx.db.setVercelInstallationPlan).not.toHaveBeenCalled();
  });

  it('answers 404 for an installation it does not know', async () => {
    ctx.db.getVercelInstallation.mockResolvedValueOnce(null);
    expect((await marketplaceError(getInstallation(INSTALLATION, ctx.deps))).status).toBe(404);
  });

  it('a downgrade to Free turns every Enforce lock into Monitor, in Vercel too', async () => {
    ctx.db.getVercelInstallation.mockResolvedValue(installation('pro'));
    ctx.db.listLiveLockResources.mockResolvedValue([
      resource({
        mode: 'enforce',
        vercel_project_id: 'prj_1',
        vercel_check_id: 'chk_1',
        target_id: 't1',
      }),
      resource({ resource_id: 'r2', mode: 'monitor' }),
    ]);
    await updateInstallationPlan(INSTALLATION, 'free', ctx.deps);
    expect(ctx.api.setProjectCheckBlocking).toHaveBeenCalledWith('prj_1', 'chk_1', false);
    expect(ctx.db.setLiveLockMode).toHaveBeenCalledWith('t1', 'monitor');
    expect(ctx.db.updateLiveLockResource).toHaveBeenCalledTimes(1);
    expect(ctx.db.setVercelInstallationPlan).toHaveBeenCalledWith(INSTALLATION, 'free');
  });

  it('uninstall removes our project checks and finalizes at once', async () => {
    ctx.db.listLiveLockResources.mockResolvedValue([
      resource({ vercel_project_id: 'prj_1', vercel_check_id: 'chk_1' }),
      resource({ resource_id: 'r2' }),
    ]);
    ctx.api.deleteProjectCheck.mockRejectedValueOnce(new Error('network'));
    expect(await deleteInstallation(INSTALLATION, ctx.deps)).toEqual({ finalized: true });
    expect(ctx.deps.apiFor).toHaveBeenCalledWith('dec:cipher');
    expect(ctx.api.deleteProjectCheck).toHaveBeenCalledWith('prj_1', 'chk_1');
    // A failed cleanup in Vercel never blocks the uninstall.
    expect(ctx.db.deleteVercelInstallation).toHaveBeenCalledWith(INSTALLATION);
  });

  it('uninstall of an unknown installation still finalizes', async () => {
    ctx.db.getVercelInstallation.mockResolvedValueOnce(null);
    expect(await deleteInstallation(INSTALLATION, ctx.deps)).toEqual({ finalized: true });
    expect(ctx.db.deleteVercelInstallation).not.toHaveBeenCalled();
  });
});

describe('resources', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  const body = { productId: 'live-lock', name: 'Production', metadata: {} };

  it('provisions a Monitor lock on Free with its id as the only secret', async () => {
    const created = await provisionResource(INSTALLATION, body, ctx.deps);
    expect(created).toMatchObject({
      id: RESOURCE,
      productId: 'live-lock',
      metadata: { mode: 'monitor' },
      status: 'ready',
      billingPlan: { id: 'free' },
      secrets: [{ name: 'ASSURLY_LIVE_LOCK_ID', value: RESOURCE }],
      notification: { title: 'Connect a project' },
    });
  });

  it('refuses Enforce on Free with a message Vercel can show', async () => {
    const error = await marketplaceError(
      provisionResource(INSTALLATION, { ...body, metadata: { mode: 'enforce' } }, ctx.deps),
    );
    expect(error.status).toBe(400);
    expect(error.toBody()).toMatchObject({
      error: { code: 'validation_error', user: { message: expect.stringContaining('Pro') } },
    });
    expect(ctx.db.createLiveLockResource).not.toHaveBeenCalled();
  });

  it('allows Enforce when the plan picked in the same flow is Pro', async () => {
    const created = await provisionResource(
      INSTALLATION,
      { ...body, metadata: { mode: 'enforce' }, billingPlanId: 'pro' },
      ctx.deps,
    );
    expect(created.metadata.mode).toBe('enforce');
    expect(ctx.db.setVercelInstallationPlan).toHaveBeenCalledWith(INSTALLATION, 'pro');
  });

  it('Free guards one project', async () => {
    ctx.db.listLiveLockResources.mockResolvedValueOnce([resource()]);
    expect((await marketplaceError(provisionResource(INSTALLATION, body, ctx.deps))).status).toBe(
      409,
    );
  });

  it('rejects another product and an unknown mode', async () => {
    await marketplaceError(
      provisionResource(INSTALLATION, { ...body, productId: 'other' }, ctx.deps),
    );
    await marketplaceError(
      provisionResource(INSTALLATION, { ...body, metadata: { mode: 'strict' } }, ctx.deps),
    );
  });

  it('a mode change reaches the project check and the lock row', async () => {
    ctx.db.getVercelInstallation.mockResolvedValue(installation('pro'));
    const connected = { vercel_project_id: 'prj_1', vercel_check_id: 'chk_1', target_id: 't1' };
    ctx.db.getLiveLockResource.mockResolvedValue(resource(connected));
    ctx.db.updateLiveLockResource.mockImplementation(async (_i, _r, patch) =>
      resource({ ...connected, ...patch }),
    );
    const updated = await updateResource(
      INSTALLATION,
      RESOURCE,
      { metadata: { mode: 'enforce' } },
      ctx.deps,
    );
    expect(ctx.api.setProjectCheckBlocking).toHaveBeenCalledWith('prj_1', 'chk_1', true);
    expect(ctx.db.setLiveLockMode).toHaveBeenCalledWith('t1', 'enforce');
    expect(updated.metadata.mode).toBe('enforce');
    expect(updated.notification).toBeUndefined();
  });

  it('delete removes the project check before the resource', async () => {
    ctx.db.getLiveLockResource.mockResolvedValue(
      resource({ vercel_project_id: 'prj_1', vercel_check_id: 'chk_1' }),
    );
    await deleteResource(INSTALLATION, RESOURCE, ctx.deps);
    expect(ctx.api.deleteProjectCheck).toHaveBeenCalledWith('prj_1', 'chk_1');
    expect(ctx.db.deleteLiveLockResource).toHaveBeenCalledWith(INSTALLATION, RESOURCE);
  });

  it('a resource of another installation is not found', async () => {
    ctx.db.getLiveLockResource.mockResolvedValueOnce(null);
    expect(
      (await marketplaceError(updateResource(INSTALLATION, RESOURCE, { name: 'x' }, ctx.deps)))
        .status,
    ).toBe(404);
  });
});
