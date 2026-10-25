import { describe, expect, it, vi } from 'vitest';
import type {
  DbAdapter,
  LiveLockCheckRow,
  LiveLockProjectRow,
  RegisterLiveLockCheckInput,
  Target,
} from './dbAdapter';
import type { DeploymentProbeResult } from './liveLock';
import {
  registerDeploymentCheck,
  rerunDeploymentCheck,
  startDeploymentCheck,
  type DeploymentCheckDeps,
} from './liveLockDeploymentCheck';
import { VercelApiError, type VercelIntegrationApi } from './vercelIntegration';

const TARGET: Target = {
  id: 'target-1',
  organization_id: 'org-1',
  kind: 'url',
  identifier: 'https://app.example.com',
  display_name: 'App',
  repository_id: null,
  generator_fingerprint: null,
  ownership_verified: true,
  ownership_method: 'dns_txt',
  current_verdict: 'ready',
  current_ship_score: 90,
  verdict_evidence: null,
  last_checked_at: null,
  badge_token: 'a'.repeat(32),
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

const PROJECT: LiveLockProjectRow = {
  target_id: 'target-1',
  organization_id: 'org-1',
  vercel_project_id: 'prj_app',
  vercel_project_name: 'app',
  vercel_team_id: 'team_1',
  mode: 'enforce',
};

const EVENT = {
  type: 'deployment.created' as const,
  deploymentId: 'dpl_1',
  projectId: 'prj_app',
  teamId: 'team_1',
  production: true,
  deploymentUrl: 'https://app-abc.vercel.app',
  gitSha: 'abc1234',
};

/** An in-memory check table with the same claim semantics as the adapter. */
function harness(
  options: { project?: LiveLockProjectRow | null; probe?: DeploymentProbeResult } = {},
) {
  const rows = new Map<string, LiveLockCheckRow>();
  const db = {
    getLiveLockProjectByVercelProject: vi.fn(async () =>
      options.project === undefined ? PROJECT : options.project,
    ),
    getTargetById: vi.fn(async () => TARGET),
    getVercelConnection: vi.fn(async () => ({
      team_id: 'team_1',
      configuration_id: 'icfg_1',
      token_ciphertext: 'v1.x.y.z',
    })),
    registerLiveLockCheck: vi.fn(async (input: RegisterLiveLockCheckInput) => {
      const existing = rows.get(input.deploymentId);
      if (existing) return existing;
      const row: LiveLockCheckRow = {
        id: `row-${input.deploymentId}`,
        organization_id: input.organizationId,
        target_id: input.targetId,
        vercel_project_id: input.vercelProjectId,
        deployment_id: input.deploymentId,
        deployment_url: input.deploymentUrl,
        git_sha: input.gitSha,
        vercel_check_id: null,
        blocking: input.blocking,
        status: 'registered',
        conclusion: null,
        reason: null,
        ship_score: null,
        blockers: [],
        run: 0,
        started_at: null,
        completed_at: null,
        created_at: '2026-10-24T10:00:00.000Z',
      };
      rows.set(input.deploymentId, row);
      return row;
    }),
    getLiveLockCheck: vi.fn(async (id: string) => rows.get(id) ?? null),
    setLiveLockCheckId: vi.fn(async (id: string, checkId: string) => {
      const row = rows.get(id);
      if (row && !row.vercel_check_id) rows.set(id, { ...row, vercel_check_id: checkId });
    }),
    claimLiveLockCheckRun: vi.fn(async (id: string) => {
      const row = rows.get(id);
      if (!row || row.status === 'running') return null;
      const next = { ...row, status: 'running' as const, run: row.run + 1 };
      rows.set(id, next);
      return next;
    }),
    completeLiveLockCheck: vi.fn(async (id: string, run: number, input) => {
      const row = rows.get(id);
      if (row && row.run === run) {
        rows.set(id, {
          ...row,
          status: 'completed',
          conclusion: input.conclusion,
          reason: input.reason,
          ship_score: input.shipScore,
          blockers: input.blockers,
        });
      }
    }),
  } as unknown as DbAdapter;

  const api: VercelIntegrationApi = {
    listProjects: vi.fn(),
    productionHosts: vi.fn(),
    createCheck: vi.fn(async () => ({ id: 'check_1' })),
    markCheckRunning: vi.fn(async () => undefined),
    completeCheck: vi.fn(async () => undefined),
    createProtectionBypass: vi.fn(async () => 'b'.repeat(32)),
    revokeProtectionBypass: vi.fn(async () => undefined),
  };
  const probe = vi.fn<DeploymentCheckDeps['probe']>(
    async () => options.probe ?? { outcome: 'clear' as const, shipScore: 95, blockers: [] },
  );
  const bypasses = new Map<string, { projectId: string; secret: string }>();
  const deps: DeploymentCheckDeps = {
    db,
    apiFor: () => api,
    probe,
    bypass: {
      read: async (targetId, projectId) => {
        const stored = bypasses.get(targetId);
        return stored && stored.projectId === projectId ? stored.secret : null;
      },
      save: async (target, projectId, secret) => {
        bypasses.set(target.id, { projectId, secret });
      },
      remove: async (targetId) => {
        bypasses.delete(targetId);
      },
    },
    detailsUrl: () => 'https://assurly.dev/dashboard',
  };
  return { rows, db, api, probe, deps, bypasses };
}

describe('registerDeploymentCheck', () => {
  it('registers one blocking check on a production deploy of an enforced project', async () => {
    const { api, deps, rows } = harness();
    await registerDeploymentCheck(EVENT, deps);
    await registerDeploymentCheck(EVENT, deps);
    expect(api.createCheck).toHaveBeenCalledTimes(1);
    expect(api.createCheck).toHaveBeenCalledWith('dpl_1', {
      blocking: true,
      detailsUrl: 'https://assurly.dev/dashboard',
    });
    expect(rows.get('dpl_1')?.vercel_check_id).toBe('check_1');
  });

  it('registers a non-blocking check in monitor mode', async () => {
    const { api, deps } = harness({ project: { ...PROJECT, mode: 'monitor' } });
    await registerDeploymentCheck(EVENT, deps);
    expect(api.createCheck).toHaveBeenCalledWith(
      'dpl_1',
      expect.objectContaining({ blocking: false }),
    );
  });

  it('ignores previews, unlocked projects and a team the lock was not made in', async () => {
    const preview = harness();
    expect(await registerDeploymentCheck({ ...EVENT, production: false }, preview.deps)).toBeNull();
    const unlocked = harness({ project: null });
    expect(await registerDeploymentCheck(EVENT, unlocked.deps)).toBeNull();
    const otherTeam = harness();
    expect(
      await registerDeploymentCheck({ ...EVENT, teamId: 'team_2' }, otherTeam.deps),
    ).toBeNull();
    for (const { api } of [preview, unlocked, otherTeam]) {
      expect(api.createCheck).not.toHaveBeenCalled();
    }
  });
});

describe('a check Vercel will not create', () => {
  it('closes the row as not verified on a 4xx, so it never waits forever', async () => {
    const { api, deps, rows } = harness();
    vi.mocked(api.createCheck).mockRejectedValueOnce(
      new VercelApiError(
        400,
        'check create',
        'bad_request Cannot create check for finished deployment',
      ),
    );
    expect(await registerDeploymentCheck(EVENT, deps)).toBeNull();
    expect(rows.get('dpl_1')).toMatchObject({
      status: 'completed',
      conclusion: 'neutral',
      reason: 'probe_unavailable',
    });
    expect(await startDeploymentCheck({ ...EVENT, type: 'deployment.ready' }, deps)).toBeNull();
  });

  it('throws on a 5xx so Vercel redelivers the event', async () => {
    const { api, deps, rows } = harness();
    vi.mocked(api.createCheck).mockRejectedValueOnce(new VercelApiError(503, 'check create'));
    await expect(registerDeploymentCheck(EVENT, deps)).rejects.toBeInstanceOf(VercelApiError);
    expect(rows.get('dpl_1')?.status).toBe('registered');
  });
});

describe('startDeploymentCheck', () => {
  it('marks the check running, probes the deployment URL and concludes it', async () => {
    const { api, deps, probe, rows } = harness({
      probe: {
        outcome: 'runtime_blocker',
        shipScore: 40,
        blockers: [{ ruleId: 'rls', message: 'Readable table.', location: 'runtime' }],
      },
    });
    await registerDeploymentCheck(EVENT, deps);
    const run = await startDeploymentCheck({ ...EVENT, type: 'deployment.ready' }, deps);
    expect(api.markCheckRunning).toHaveBeenCalledWith('dpl_1', 'check_1');
    expect(probe).not.toHaveBeenCalled();

    await run?.();
    expect(probe).toHaveBeenCalledWith(TARGET, 'https://app-abc.vercel.app', null);
    expect(api.completeCheck).toHaveBeenCalledWith('dpl_1', 'check_1', {
      conclusion: 'failed',
      detailsUrl: 'https://assurly.dev/dashboard',
    });
    expect(rows.get('dpl_1')).toMatchObject({
      status: 'completed',
      conclusion: 'failed',
      reason: 'runtime_blocker',
      ship_score: 40,
    });
  });

  it('registers first when ready arrives before created', async () => {
    const { api, deps } = harness();
    const run = await startDeploymentCheck({ ...EVENT, type: 'deployment.ready' }, deps);
    expect(api.createCheck).toHaveBeenCalledTimes(1);
    expect(run).not.toBeNull();
  });

  it('does not probe twice for a redelivered ready event', async () => {
    const { deps } = harness();
    await registerDeploymentCheck(EVENT, deps);
    const first = await startDeploymentCheck({ ...EVENT, type: 'deployment.ready' }, deps);
    const second = await startDeploymentCheck({ ...EVENT, type: 'deployment.ready' }, deps);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('releases the deploy as neutral when the probe throws', async () => {
    const { api, deps, probe } = harness();
    probe.mockRejectedValueOnce(new Error('boom'));
    await registerDeploymentCheck(EVENT, deps);
    const run = await startDeploymentCheck({ ...EVENT, type: 'deployment.ready' }, deps);
    await run?.();
    expect(api.completeCheck).toHaveBeenCalledWith(
      'dpl_1',
      'check_1',
      expect.objectContaining({ conclusion: 'neutral' }),
    );
  });
});

describe('a Vercel failure while starting', () => {
  it('gives the run back so the redelivered event can claim it', async () => {
    const { api, deps } = harness();
    await registerDeploymentCheck(EVENT, deps);
    vi.mocked(api.markCheckRunning).mockRejectedValueOnce(new Error('Vercel 500'));

    await expect(
      startDeploymentCheck({ ...EVENT, type: 'deployment.ready' }, deps),
    ).rejects.toThrow('Vercel 500');
    const retry = await startDeploymentCheck({ ...EVENT, type: 'deployment.ready' }, deps);
    expect(retry).not.toBeNull();
  });
});

describe('rerunDeploymentCheck', () => {
  it('reruns a completed check and ignores a check id that is not ours', async () => {
    const { deps, probe } = harness();
    await registerDeploymentCheck(EVENT, deps);
    await (
      await startDeploymentCheck({ ...EVENT, type: 'deployment.ready' }, deps)
    )?.();

    const foreign = await rerunDeploymentCheck(
      { type: 'deployment.check-rerequested', deploymentId: 'dpl_1', checkId: 'check_other' },
      deps,
    );
    expect(foreign).toBeNull();

    const rerun = await rerunDeploymentCheck(
      { type: 'deployment.check-rerequested', deploymentId: 'dpl_1', checkId: 'check_1' },
      deps,
    );
    await rerun?.();
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

describe('Deployment Protection', () => {
  const PROTECTED: DeploymentProbeResult = {
    outcome: 'deployment_protected',
    shipScore: null,
    blockers: [],
  };
  const BLOCKED: DeploymentProbeResult = {
    outcome: 'runtime_blocker',
    shipScore: 40,
    blockers: [{ ruleId: 'rls', message: 'Readable table.', location: 'runtime' }],
  };

  async function runOnce(h: ReturnType<typeof harness>): Promise<void> {
    await registerDeploymentCheck(EVENT, h.deps);
    await (
      await startDeploymentCheck({ ...EVENT, type: 'deployment.ready' }, h.deps)
    )?.();
  }

  it('never mints a bypass for a project that is not protected', async () => {
    const h = harness();
    await runOnce(h);
    expect(h.probe).toHaveBeenCalledTimes(1);
    expect(h.api.createProtectionBypass).not.toHaveBeenCalled();
  });

  it('mints the integration bypass when protection keeps the probe out, then checks the build', async () => {
    const h = harness();
    h.probe.mockResolvedValueOnce(PROTECTED).mockResolvedValueOnce(BLOCKED);
    await runOnce(h);
    expect(h.api.createProtectionBypass).toHaveBeenCalledWith('prj_app', 'icfg_1');
    expect(h.probe).toHaveBeenLastCalledWith(TARGET, 'https://app-abc.vercel.app', 'b'.repeat(32));
    expect(h.bypasses.get('target-1')).toEqual({ projectId: 'prj_app', secret: 'b'.repeat(32) });
    expect(h.rows.get('dpl_1')).toMatchObject({ conclusion: 'failed', reason: 'runtime_blocker' });
  });

  it('uses the stored bypass first and replaces it once it stops working', async () => {
    const h = harness();
    h.bypasses.set('target-1', { projectId: 'prj_app', secret: 'a'.repeat(32) });
    h.probe.mockResolvedValueOnce(PROTECTED).mockResolvedValueOnce(BLOCKED);
    await runOnce(h);
    expect(h.probe.mock.calls[0]?.[2]).toBe('a'.repeat(32));
    expect(h.probe.mock.calls[1]?.[2]).toBe('b'.repeat(32));
    expect(h.bypasses.get('target-1')?.secret).toBe('b'.repeat(32));
  });

  it('ignores a stored bypass for a different project', async () => {
    const h = harness();
    h.bypasses.set('target-1', { projectId: 'prj_other', secret: 'a'.repeat(32) });
    await runOnce(h);
    expect(h.probe.mock.calls[0]?.[2]).toBeNull();
  });

  it('stays not verified, and never holds the deploy, without the bypass scope', async () => {
    const h = harness();
    h.probe.mockResolvedValue(PROTECTED);
    vi.mocked(h.api.createProtectionBypass).mockRejectedValueOnce(
      new VercelApiError(403, 'protection bypass create'),
    );
    await runOnce(h);
    expect(h.probe).toHaveBeenCalledTimes(1);
    expect(h.bypasses.size).toBe(0);
    expect(h.rows.get('dpl_1')).toMatchObject({
      conclusion: 'neutral',
      reason: 'deployment_protected',
    });
  });
});
