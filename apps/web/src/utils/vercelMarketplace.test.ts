import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DbAdapter,
  LiveLockResourceRow,
  VercelInstallationRow,
  VercelInvoiceState,
  VercelPlanChangeRow,
} from './dbAdapter';
import {
  applyBillingStatus,
  deleteInstallation,
  effectivePlan,
  handleInvoiceEvent,
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
    billing_status: 'ok',
    deleted_at: null,
    created_at: '2026-10-01T00:00:00Z',
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
    markVercelInstallationDeleted: vi.fn(async () => 'org-1'),
    setVercelBillingStatus: vi.fn(async () => true),
    listVercelPlanChanges: vi.fn(
      async (): Promise<VercelPlanChangeRow[]> => [
        { plan_id: 'free', effective_at: '2026-10-01T00:00:00Z' },
      ],
    ),
    claimVercelInvoice: vi.fn(
      async (): Promise<{
        state: VercelInvoiceState;
        vercel_invoice_id: string | null;
        attempts: number;
      }> => ({ state: 'pending', vercel_invoice_id: null, attempts: 0 }),
    ),
    recordVercelInvoiceAttempt: vi.fn(async () => undefined),
    setVercelInvoiceState: vi.fn(async (): Promise<string | null> => INSTALLATION),
    setLiveLockMode: vi.fn(async () => null),
  };
  const api = {
    createProjectCheck: vi.fn(),
    setProjectCheckBlocking: vi.fn(async () => undefined),
    deleteProjectCheck: vi.fn(async () => undefined),
    updateCheckRun: vi.fn(),
    getDeployment: vi.fn(),
    submitBillingData: vi.fn(async () => undefined),
    submitInvoice: vi.fn(async () => ({ invoiceId: 'inv_1' })),
    setInstallationNotification: vi.fn(async () => undefined),
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

  const NOW = new Date('2026-10-26T12:00:00Z');

  it('uninstall on Free removes our checks, owes nothing and finalizes at once', async () => {
    ctx.db.listLiveLockResources.mockResolvedValue([
      resource({ vercel_project_id: 'prj_1', vercel_check_id: 'chk_1' }),
      resource({ resource_id: 'r2' }),
    ]);
    ctx.api.deleteProjectCheck.mockRejectedValueOnce(new Error('network'));
    expect(await deleteInstallation(INSTALLATION, ctx.deps, NOW)).toEqual({ finalized: true });
    expect(ctx.deps.apiFor).toHaveBeenCalledWith('dec:cipher');
    expect(ctx.api.deleteProjectCheck).toHaveBeenCalledWith('prj_1', 'chk_1');
    // A failed cleanup in Vercel never blocks the uninstall.
    expect(ctx.db.markVercelInstallationDeleted).toHaveBeenCalledWith(INSTALLATION);
    expect(ctx.api.submitInvoice).not.toHaveBeenCalled();
    expect(ctx.db.deleteVercelInstallation).toHaveBeenCalledWith(INSTALLATION);
  });

  it('uninstall on Pro sends the final invoice for the month so far', async () => {
    ctx.db.listVercelPlanChanges.mockResolvedValue([
      { plan_id: 'pro', effective_at: '2026-09-15T00:00:00Z' },
    ]);
    // September is already invoiced; October is the final one.
    ctx.db.claimVercelInvoice
      .mockResolvedValueOnce({ state: 'paid', vercel_invoice_id: 'inv_sep', attempts: 1 })
      .mockResolvedValueOnce({ state: 'pending', vercel_invoice_id: null, attempts: 0 });
    expect(await deleteInstallation(INSTALLATION, ctx.deps, NOW)).toEqual({ finalized: true });
    expect(ctx.api.submitInvoice).toHaveBeenCalledTimes(1);
    const [, body] = ctx.api.submitInvoice.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(body).toMatchObject({
      externalId: `${INSTALLATION}:2026-10`,
      final: true,
      items: [{ billingPlanId: 'pro', price: '17.00', units: 'month' }],
    });
    expect(ctx.db.recordVercelInvoiceAttempt).toHaveBeenCalledWith(
      INSTALLATION,
      '2026-10-01T00:00:00.000Z',
      'inv_1',
      null,
    );
    expect(ctx.db.deleteVercelInstallation).toHaveBeenCalledWith(INSTALLATION);
  });

  it('keeps the installation open when the final invoice cannot be sent yet', async () => {
    ctx.db.listVercelPlanChanges.mockResolvedValue([
      { plan_id: 'pro', effective_at: '2026-09-15T00:00:00Z' },
    ]);
    ctx.db.claimVercelInvoice.mockResolvedValue({
      state: 'pending',
      vercel_invoice_id: null,
      attempts: 0,
    });
    ctx.api.submitInvoice.mockRejectedValue(new Error('503'));
    expect(await deleteInstallation(INSTALLATION, ctx.deps, NOW)).toEqual({ finalized: false });
    expect(ctx.db.deleteVercelInstallation).not.toHaveBeenCalled();
  });

  it('uninstall of an unknown installation still finalizes', async () => {
    ctx.db.getVercelInstallation.mockResolvedValueOnce(null);
    expect(await deleteInstallation(INSTALLATION, ctx.deps)).toEqual({ finalized: true });
    expect(ctx.db.deleteVercelInstallation).not.toHaveBeenCalled();
  });

  it('a deleted installation answers 404 to the Partner API', async () => {
    ctx.db.getVercelInstallation.mockResolvedValueOnce({
      ...installation(),
      deleted_at: '2026-10-26T00:00:00Z',
    });
    expect((await marketplaceError(getInstallation(INSTALLATION, ctx.deps))).status).toBe(404);
  });
});

describe('billing status', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
    ctx.db.getVercelInstallation.mockResolvedValue(installation('pro'));
    ctx.db.listLiveLockResources.mockResolvedValue([
      resource({ mode: 'enforce', vercel_project_id: 'prj_1', vercel_check_id: 'chk_1' }),
      resource({
        resource_id: 'r2',
        mode: 'monitor',
        vercel_project_id: 'prj_2',
        vercel_check_id: 'chk_2',
      }),
    ]);
  });

  it('Pro counts only while paid for', () => {
    expect(effectivePlan(installation('pro'))).toBe('pro');
    expect(effectivePlan({ ...installation('pro'), billing_status: 'overdue' })).toBe('free');
    expect(effectivePlan({ ...installation('pro'), deleted_at: '2026-10-26T00:00:00Z' })).toBe(
      'free',
    );
    expect(effectivePlan(installation('free'))).toBe('free');
  });

  it('overdue pauses Enforce in Vercel and says why, without touching Monitor', async () => {
    await applyBillingStatus(INSTALLATION, 'overdue', ctx.deps);
    expect(ctx.db.setVercelBillingStatus).toHaveBeenCalledWith(INSTALLATION, 'overdue');
    expect(ctx.api.setProjectCheckBlocking).toHaveBeenCalledTimes(1);
    expect(ctx.api.setProjectCheckBlocking).toHaveBeenCalledWith('prj_1', 'chk_1', false);
    expect(ctx.api.setInstallationNotification).toHaveBeenCalledWith(
      INSTALLATION,
      expect.objectContaining({ level: 'error' }),
    );
    // The choice of Enforce is kept, so paying restores it.
    expect(ctx.db.updateLiveLockResource).not.toHaveBeenCalled();
  });

  it('a paid invoice resumes Enforce and clears the notice', async () => {
    ctx.db.getVercelInstallation.mockResolvedValue({
      ...installation('pro'),
      billing_status: 'overdue',
    });
    expect(
      await handleInvoiceEvent(
        { state: 'paid', installationId: INSTALLATION, invoiceId: 'inv_1' },
        ctx.deps,
      ),
    ).toBe('recorded');
    expect(ctx.db.setVercelInvoiceState).toHaveBeenCalledWith('inv_1', 'paid');
    expect(ctx.db.setVercelBillingStatus).toHaveBeenCalledWith(INSTALLATION, 'ok');
    expect(ctx.api.setProjectCheckBlocking).toHaveBeenCalledWith('prj_1', 'chk_1', true);
    expect(ctx.api.setInstallationNotification).toHaveBeenCalledWith(INSTALLATION, null);
  });

  it('a failed payment only warns', async () => {
    await handleInvoiceEvent(
      { state: 'notpaid', installationId: INSTALLATION, invoiceId: 'inv_1' },
      ctx.deps,
    );
    expect(ctx.db.setVercelBillingStatus).not.toHaveBeenCalled();
    expect(ctx.api.setProjectCheckBlocking).not.toHaveBeenCalled();
    expect(ctx.api.setInstallationNotification).toHaveBeenCalledWith(
      INSTALLATION,
      expect.objectContaining({ level: 'warn' }),
    );
  });

  it('ignores an invoice Assurly did not send, or one for another installation', async () => {
    ctx.db.setVercelInvoiceState.mockResolvedValueOnce(null);
    expect(
      await handleInvoiceEvent(
        { state: 'overdue', installationId: INSTALLATION, invoiceId: 'inv_x' },
        ctx.deps,
      ),
    ).toBe('unknown_invoice');
    ctx.db.setVercelInvoiceState.mockResolvedValueOnce('icfg_other');
    expect(
      await handleInvoiceEvent(
        { state: 'overdue', installationId: INSTALLATION, invoiceId: 'inv_y' },
        ctx.deps,
      ),
    ).toBe('unknown_invoice');
    expect(ctx.db.setVercelBillingStatus).not.toHaveBeenCalled();
  });

  it('overdue Pro cannot turn on Enforce', async () => {
    ctx.db.getVercelInstallation.mockResolvedValue({
      ...installation('pro'),
      billing_status: 'overdue',
    });
    const error = await marketplaceError(
      updateResource(INSTALLATION, RESOURCE, { metadata: { mode: 'enforce' } }, ctx.deps),
    );
    expect(error.status).toBe(400);
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
