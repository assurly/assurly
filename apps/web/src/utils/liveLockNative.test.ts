import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DbAdapter,
  LiveLockCheckRow,
  LiveLockProjectRow,
  LiveLockResourceRow,
  Target,
  VercelInstallationRow,
} from './dbAdapter';
import type { DeploymentProbeResult } from './liveLock';
import { readIntegrationEvent } from './liveLockCheck';
import {
  checkRunSummary,
  connectResource,
  disconnectResource,
  startCheckRun,
  type NativeLockDeps,
} from './liveLockNative';
import type { MarketplaceDeployment, VercelMarketplaceApi } from './vercelMarketplaceApi';

const INSTALLATION = 'icfg_abc123';
const RESOURCE = '11111111-1111-4111-8111-111111111111';
const DEPLOYMENT = 'dpl_abc';
const CHECK_RUN = 'crun_1';

function installation(plan: 'free' | 'pro' = 'pro'): VercelInstallationRow {
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
    mode: 'enforce',
    status: 'ready',
    vercel_project_id: null,
    target_id: null,
    vercel_check_id: null,
    created_at: '2026-10-25T00:00:00Z',
    ...overrides,
  };
}

const connected = { vercel_project_id: 'prj_app', target_id: 'target-1', vercel_check_id: 'chk_1' };

const TARGET = {
  id: 'target-1',
  organization_id: 'org-1',
  kind: 'url',
  identifier: 'https://app.example.com',
  ownership_verified: true,
} as Target;

function checkRow(overrides: Partial<LiveLockCheckRow> = {}): LiveLockCheckRow {
  return {
    id: 'row-1',
    organization_id: 'org-1',
    target_id: 'target-1',
    vercel_project_id: 'prj_app',
    deployment_id: DEPLOYMENT,
    deployment_url: 'https://app-abc.vercel.app',
    git_sha: null,
    vercel_check_id: CHECK_RUN,
    blocking: true,
    status: 'running',
    conclusion: null,
    reason: null,
    ship_score: null,
    blockers: [],
    run: 1,
    started_at: null,
    completed_at: null,
    created_at: '2026-10-25T00:00:00Z',
    ...overrides,
  };
}

function setup() {
  const db = {
    getVercelInstallation: vi.fn(async (): Promise<VercelInstallationRow | null> => installation()),
    getLiveLockResource: vi.fn(async (): Promise<LiveLockResourceRow | null> => resource()),
    updateLiveLockResource: vi.fn(async () => null),
    getLiveLockProjectByVercelProject: vi.fn(async (): Promise<LiveLockProjectRow | null> => null),
    deleteLiveLockProject: vi.fn(async () => undefined),
    upsertTarget: vi.fn(async () => TARGET),
    setTargetOwnership: vi.fn(async () => TARGET),
    upsertLiveLockProject: vi.fn(async () => ({}) as LiveLockProjectRow),
    getLiveLockBypass: vi.fn(
      async (): Promise<{ vercel_project_id: string; secret_ciphertext: string } | null> => null,
    ),
    deleteLiveLockBypass: vi.fn(async () => undefined),
    getTargetById: vi.fn(async (): Promise<Target | null> => TARGET),
    registerLiveLockCheck: vi.fn(async () => checkRow({ status: 'registered', run: 0 })),
    setLiveLockCheckRun: vi.fn(async () => undefined),
    claimLiveLockCheckRun: vi.fn(async (): Promise<LiveLockCheckRow | null> => checkRow()),
    completeLiveLockCheck: vi.fn(async () => undefined),
  };
  const api = {
    createProjectCheck: vi.fn(async () => ({ id: 'chk_new' })),
    setProjectCheckBlocking: vi.fn(async () => undefined),
    deleteProjectCheck: vi.fn(async () => undefined),
    updateCheckRun: vi.fn(async () => undefined),
    getDeployment: vi.fn(
      async (): Promise<MarketplaceDeployment> => ({
        id: DEPLOYMENT,
        url: 'https://app-abc.vercel.app',
        projectId: 'prj_app',
        production: true,
        gitSha: 'abc1234',
      }),
    ),
    submitBillingData: vi.fn(async () => undefined),
    submitInvoice: vi.fn(async () => ({ invoiceId: 'inv_1' })),
    setInstallationNotification: vi.fn(async () => undefined),
  } satisfies VercelMarketplaceApi;
  const integration = {
    createProtectionBypass: vi.fn(async () => 'b'.repeat(32)),
    revokeProtectionBypass: vi.fn(async () => undefined),
  };
  const probe = vi.fn<NativeLockDeps['probe']>(
    async (): Promise<DeploymentProbeResult> => ({ outcome: 'clear', shipScore: 92, blockers: [] }),
  );
  const deps: NativeLockDeps = {
    db: db as unknown as DbAdapter,
    decryptToken: (cipher) => `dec:${cipher}`,
    marketplaceApiFor: vi.fn(() => api),
    integrationApiFor: vi.fn(() => integration),
    probe,
    bypass: {
      read: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    },
    detailsUrl: (targetId) => `https://assurly.test/dashboard?target=${targetId}`,
  };
  return { db, api, integration, probe, deps };
}

const connectEvent = {
  type: 'integration-resource.project-connected' as const,
  installationId: INSTALLATION,
  resourceId: RESOURCE,
  projectId: 'prj_app',
  projectName: 'app',
  productionOrigin: 'https://app.example.com',
};

describe('connectResource', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('guards the production domain with a blocking project check on Pro + Enforce', async () => {
    expect(await connectResource(connectEvent, ctx.deps)).toBe('connected');
    expect(ctx.db.upsertTarget).toHaveBeenCalledWith({
      organizationId: 'org-1',
      kind: 'url',
      identifier: 'https://app.example.com',
      displayName: 'app',
    });
    expect(ctx.db.setTargetOwnership).toHaveBeenCalledWith('target-1', {
      ownershipVerified: true,
      ownershipMethod: 'vercel_project',
    });
    expect(ctx.api.createProjectCheck).toHaveBeenCalledWith('prj_app', {
      resourceId: RESOURCE,
      blocking: true,
    });
    expect(ctx.db.updateLiveLockResource).toHaveBeenCalledWith(INSTALLATION, RESOURCE, {
      vercel_project_id: 'prj_app',
      target_id: 'target-1',
      vercel_check_id: 'chk_new',
    });
    expect(ctx.db.upsertLiveLockProject).toHaveBeenCalledWith(
      expect.objectContaining({ vercelTeamId: null, resourceId: RESOURCE, mode: 'enforce' }),
    );
  });

  it('never blocks on Free, whatever the resource says', async () => {
    ctx.db.getVercelInstallation.mockResolvedValue(installation('free'));
    await connectResource(connectEvent, ctx.deps);
    expect(ctx.api.createProjectCheck).toHaveBeenCalledWith('prj_app', {
      resourceId: RESOURCE,
      blocking: false,
    });
  });

  it('is idempotent on redelivery', async () => {
    ctx.db.getLiveLockResource.mockResolvedValue(resource(connected));
    expect(await connectResource(connectEvent, ctx.deps)).toBe('already_connected');
    expect(ctx.api.createProjectCheck).not.toHaveBeenCalled();
  });

  it('one lock guards one project', async () => {
    ctx.db.getLiveLockResource.mockResolvedValue(
      resource({ ...connected, vercel_project_id: 'prj_other' }),
    );
    expect(await connectResource(connectEvent, ctx.deps)).toBe('resource_in_use');
  });

  it('does not take a project another native lock guards', async () => {
    ctx.db.getLiveLockProjectByVercelProject.mockResolvedValue({
      resource_id: 'other',
    } as LiveLockProjectRow);
    expect(await connectResource(connectEvent, ctx.deps)).toBe('project_taken');
    expect(ctx.db.upsertTarget).not.toHaveBeenCalled();
  });

  it('replaces a lock from the older connectable install', async () => {
    ctx.db.getLiveLockProjectByVercelProject.mockResolvedValue({
      resource_id: null,
      target_id: 'old-target',
    } as LiveLockProjectRow);
    expect(await connectResource(connectEvent, ctx.deps)).toBe('connected');
    expect(ctx.db.deleteLiveLockProject).toHaveBeenCalledWith('old-target');
  });

  it('ignores unknown resources and a missing domain', async () => {
    expect(await connectResource({ ...connectEvent, resourceId: 'not-a-uuid' }, ctx.deps)).toBe(
      'unknown_resource',
    );
    ctx.db.getLiveLockResource.mockResolvedValueOnce(null);
    expect(await connectResource(connectEvent, ctx.deps)).toBe('unknown_resource');
    expect(await connectResource({ ...connectEvent, productionOrigin: null }, ctx.deps)).toBe(
      'no_domain',
    );
  });
});

describe('disconnectResource', () => {
  it('removes the check, revokes our bypass and unlinks', async () => {
    const ctx = setup();
    ctx.db.getLiveLockResource.mockResolvedValue(resource(connected));
    ctx.db.getLiveLockBypass.mockResolvedValue({
      vercel_project_id: 'prj_app',
      secret_ciphertext: 'sec',
    });
    const done = await disconnectResource(
      {
        type: 'integration-resource.project-disconnected',
        installationId: INSTALLATION,
        resourceId: RESOURCE,
        projectId: 'prj_app',
      },
      ctx.deps,
    );
    expect(done).toBe(true);
    expect(ctx.api.deleteProjectCheck).toHaveBeenCalledWith('prj_app', 'chk_1');
    expect(ctx.integration.revokeProtectionBypass).toHaveBeenCalledWith('prj_app', 'dec:sec');
    expect(ctx.db.deleteLiveLockProject).toHaveBeenCalledWith('target-1');
    expect(ctx.db.updateLiveLockResource).toHaveBeenCalledWith(INSTALLATION, RESOURCE, {
      vercel_project_id: null,
      target_id: null,
      vercel_check_id: null,
    });
  });

  it('ignores a project the lock is not connected to', async () => {
    const ctx = setup();
    ctx.db.getLiveLockResource.mockResolvedValue(resource(connected));
    expect(
      await disconnectResource(
        {
          type: 'integration-resource.project-disconnected',
          installationId: INSTALLATION,
          resourceId: RESOURCE,
          projectId: 'prj_other',
        },
        ctx.deps,
      ),
    ).toBe(false);
    expect(ctx.db.updateLiveLockResource).not.toHaveBeenCalled();
  });
});

const runEvent = {
  type: 'deployment.checkrun.start' as const,
  installationId: INSTALLATION,
  resourceId: RESOURCE,
  deploymentId: DEPLOYMENT,
  checkRunId: CHECK_RUN,
};

describe('startCheckRun', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
    ctx.db.getLiveLockResource.mockResolvedValue(resource(connected));
  });

  it('registers, marks running, then fails the run on a proven blocker in Enforce', async () => {
    ctx.probe.mockResolvedValueOnce({
      outcome: 'runtime_blocker',
      shipScore: 40,
      blockers: [{ ruleId: 'r', message: 'Admin API is public', location: '/api/admin' }],
    });
    const run = await startCheckRun(runEvent, ctx.deps);
    expect(ctx.db.registerLiveLockCheck).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'check_run', checkId: CHECK_RUN, blocking: true }),
    );
    expect(ctx.api.updateCheckRun).toHaveBeenCalledWith(DEPLOYMENT, CHECK_RUN, {
      status: 'running',
    });
    await run?.();
    expect(ctx.probe).toHaveBeenCalledWith(TARGET, 'https://app-abc.vercel.app', null);
    expect(ctx.api.updateCheckRun).toHaveBeenLastCalledWith(DEPLOYMENT, CHECK_RUN, {
      status: 'completed',
      conclusion: 'failed',
      conclusionText: 'Held back. 1 proven blocker: Admin API is public',
      externalUrl: 'https://assurly.test/dashboard?target=target-1',
    });
  });

  it('Monitor never fails a run', async () => {
    ctx.db.getLiveLockResource.mockResolvedValue(resource({ ...connected, mode: 'monitor' }));
    ctx.probe.mockResolvedValueOnce({ outcome: 'runtime_blocker', shipScore: 40, blockers: [] });
    await (
      await startCheckRun(runEvent, ctx.deps)
    )?.();
    expect(ctx.api.updateCheckRun).toHaveBeenLastCalledWith(
      DEPLOYMENT,
      CHECK_RUN,
      expect.objectContaining({ conclusion: 'neutral' }),
    );
  });

  it('mints the native bypass when Deployment Protection keeps the probe out', async () => {
    ctx.probe
      .mockResolvedValueOnce({ outcome: 'deployment_protected', shipScore: null, blockers: [] })
      .mockResolvedValueOnce({ outcome: 'clear', shipScore: 90, blockers: [] });
    await (
      await startCheckRun(runEvent, ctx.deps)
    )?.();
    expect(ctx.integration.createProtectionBypass).toHaveBeenCalledWith('prj_app', INSTALLATION);
    expect(ctx.deps.bypass.save).toHaveBeenCalledWith(TARGET, 'prj_app', 'b'.repeat(32));
    expect(ctx.api.updateCheckRun).toHaveBeenLastCalledWith(
      DEPLOYMENT,
      CHECK_RUN,
      expect.objectContaining({ conclusion: 'succeeded' }),
    );
  });

  it('releases a deployment of another project at once, without probing', async () => {
    ctx.api.getDeployment.mockResolvedValueOnce({
      id: DEPLOYMENT,
      url: 'https://evil.vercel.app',
      projectId: 'prj_other',
      production: true,
      gitSha: null,
    });
    expect(await startCheckRun(runEvent, ctx.deps)).toBeNull();
    expect(ctx.probe).not.toHaveBeenCalled();
    expect(ctx.api.updateCheckRun).toHaveBeenCalledWith(
      DEPLOYMENT,
      CHECK_RUN,
      expect.objectContaining({ status: 'completed', conclusion: 'neutral' }),
    );
  });

  it('releases a run for a lock that lost its project', async () => {
    ctx.db.getLiveLockResource.mockResolvedValue(resource());
    expect(await startCheckRun(runEvent, ctx.deps)).toBeNull();
    expect(ctx.api.updateCheckRun).toHaveBeenCalledWith(
      DEPLOYMENT,
      CHECK_RUN,
      expect.objectContaining({ conclusion: 'neutral' }),
    );
  });

  it('a Rerun points the row at the new check run', async () => {
    ctx.db.registerLiveLockCheck.mockResolvedValueOnce(
      checkRow({ vercel_check_id: 'crun_old', status: 'completed' }),
    );
    await startCheckRun(runEvent, ctx.deps);
    expect(ctx.db.setLiveLockCheckRun).toHaveBeenCalledWith(DEPLOYMENT, CHECK_RUN);
  });

  it('does nothing while another delivery holds the run', async () => {
    ctx.db.claimLiveLockCheckRun.mockResolvedValueOnce(null);
    expect(await startCheckRun(runEvent, ctx.deps)).toBeNull();
    expect(ctx.api.updateCheckRun).not.toHaveBeenCalled();
  });
});

describe('checkRunSummary', () => {
  it('says plainly what happened', () => {
    expect(checkRunSummary('enforce', { outcome: 'clear', shipScore: 90, blockers: [] })).toBe(
      'No proven blocker on the live deployment.',
    );
    expect(
      checkRunSummary('monitor', { outcome: 'runtime_blocker', shipScore: 1, blockers: [] }),
    ).toBe('Monitor mode, would hold back. 0 proven blockers');
    expect(
      checkRunSummary('enforce', {
        outcome: 'deployment_protected',
        shipScore: null,
        blockers: [],
      }),
    ).toMatch(/^Not verified/);
  });
});

describe('readIntegrationEvent (native events)', () => {
  it('reads invoice webhooks by Vercel’s event names', () => {
    const payload = { configuration: { id: INSTALLATION }, invoiceId: 'inv_1' };
    expect(readIntegrationEvent({ type: 'marketplace.invoice.overdue', payload })).toEqual({
      type: 'marketplace.invoice',
      state: 'overdue',
      installationId: INSTALLATION,
      invoiceId: 'inv_1',
    });
    expect(readIntegrationEvent({ type: 'marketplace.invoice.created', payload })).toMatchObject({
      state: 'invoiced',
    });
    expect(
      readIntegrationEvent({ type: 'marketplace.invoice.paid', payload: { invoiceId: 'inv_1' } }),
    ).toEqual({ type: 'ignored' });
    expect(readIntegrationEvent({ type: 'marketplace.invoice.unknown', payload })).toEqual({
      type: 'ignored',
    });
  });

  it('reads project-connected with a safe production origin', () => {
    const event = readIntegrationEvent({
      type: 'integration-resource.project-connected',
      payload: {
        installationId: INSTALLATION,
        resourceId: RESOURCE,
        project: { id: 'prj_app', name: 'app' },
        productionDomain: 'App.Example.com',
      },
    });
    expect(event).toEqual({ ...connectEvent, productionOrigin: 'https://app.example.com' });
  });

  it('drops a production domain that is not a public host', () => {
    for (const productionDomain of [
      'localhost',
      '127.0.0.1',
      'x.com:8080',
      'x.com/path',
      'javascript:alert(1)',
    ]) {
      const event = readIntegrationEvent({
        type: 'integration-resource.project-connected',
        payload: {
          installationId: INSTALLATION,
          resourceId: RESOURCE,
          projectId: 'prj_app',
          productionDomain,
        },
      });
      expect(event).toMatchObject({ productionOrigin: null });
    }
  });

  it('reads deployment.checkrun.start only from an integration source', () => {
    const payload = {
      deployment: { id: DEPLOYMENT },
      checkRun: {
        id: CHECK_RUN,
        source: {
          kind: 'integration',
          integrationConfigurationId: INSTALLATION,
          externalResourceId: RESOURCE,
        },
      },
    };
    expect(readIntegrationEvent({ type: 'deployment.checkrun.start', payload })).toEqual(runEvent);
    expect(
      readIntegrationEvent({
        type: 'deployment.checkrun.start',
        payload: { ...payload, checkRun: { ...payload.checkRun, source: { kind: 'webhook' } } },
      }),
    ).toEqual({ type: 'ignored' });
  });
});
