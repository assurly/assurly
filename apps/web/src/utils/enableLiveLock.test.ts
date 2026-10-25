import { describe, expect, it, vi } from 'vitest';
import type { LiveLockProjectRow, Target, UpsertLiveLockProjectInput } from './dbAdapter';
import { linkLiveLockProject } from './enableLiveLock';
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

function api(hosts: Record<string, string[]>): VercelIntegrationApi {
  return {
    listProjects: vi.fn(async () =>
      Object.keys(hosts).map((id) => ({ id, name: id.replace('prj_', '') })),
    ),
    productionHosts: vi.fn(async (id: string) => hosts[id] ?? []),
    createCheck: vi.fn(),
    markCheckRunning: vi.fn(),
    completeCheck: vi.fn(),
    createProtectionBypass: vi.fn(),
    revokeProtectionBypass: vi.fn(),
  };
}

function link(
  client: VercelIntegrationApi,
  overrides: Partial<Parameters<typeof linkLiveLockProject>[0]> = {},
) {
  const save = vi.fn(
    async (input: UpsertLiveLockProjectInput): Promise<LiveLockProjectRow> => ({
      target_id: input.targetId,
      organization_id: input.organizationId,
      vercel_project_id: input.vercelProjectId,
      vercel_project_name: input.vercelProjectName,
      vercel_team_id: input.vercelTeamId,
      mode: input.mode,
      resource_id: null,
    }),
  );
  return {
    save,
    result: linkLiveLockProject({
      target: TARGET,
      api: client,
      teamId: 'team_1',
      chosenProjectId: null,
      existing: null,
      installUrl: 'https://vercel.com/integrations/x/new',
      save,
      ...overrides,
    }),
  };
}

describe('linkLiveLockProject', () => {
  it('locks the project that serves the verified domain, in monitor mode', async () => {
    const { result, save } = link(
      api({ prj_other: ['other.example.com'], prj_app: ['app.example.com', 'app.vercel.app'] }),
    );
    expect(await result).toMatchObject({ status: 'active', projectName: 'app', mode: 'monitor' });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        vercelProjectId: 'prj_app',
        vercelTeamId: 'team_1',
        mode: 'monitor',
      }),
    );
  });

  it('keeps the mode when the same project is linked again', async () => {
    const { result } = link(api({ prj_app: ['app.example.com'] }), {
      existing: {
        target_id: 'target-1',
        organization_id: 'org-1',
        vercel_project_id: 'prj_app',
        vercel_project_name: 'app',
        vercel_team_id: 'team_1',
        mode: 'enforce',
        resource_id: null,
      },
    });
    expect((await result).mode).toBe('enforce');
  });

  it('lists projects when none serves the domain', async () => {
    const { result, save } = link(api({ prj_app: ['other.example.com'] }));
    expect(await result).toMatchObject({
      status: 'vercel_project_required',
      projects: [{ id: 'prj_app', name: 'app' }],
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses a picked project that does not serve the domain', async () => {
    const { result, save } = link(api({ prj_app: ['other.example.com'] }), {
      chosenProjectId: 'prj_app',
    });
    expect((await result).status).toBe('project_mismatch');
    expect(save).not.toHaveBeenCalled();
  });

  it('asks to reconnect when Vercel rejects the token', async () => {
    const client = api({});
    vi.mocked(client.listProjects).mockRejectedValue(new VercelApiError(403, 'project list'));
    const { result } = link(client);
    expect(await result).toMatchObject({
      status: 'vercel_required',
      installUrl: 'https://vercel.com/integrations/x/new',
    });
  });

  it('does nothing for an unverified URL', async () => {
    const client = api({ prj_app: ['app.example.com'] });
    const { result } = link(client, { target: { ...TARGET, ownership_verified: false } });
    expect((await result).status).toBe('ownership_required');
    expect(client.listProjects).not.toHaveBeenCalled();
  });
});
