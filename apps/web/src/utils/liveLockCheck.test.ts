import { describe, expect, it } from 'vitest';
import { conclusionFor, isVercelDeploymentUrl, readIntegrationEvent } from './liveLockCheck';

describe('conclusionFor', () => {
  it('fails only a proven blocker, and only in enforce mode', () => {
    expect(conclusionFor('enforce', 'runtime_blocker')).toBe('failed');
    expect(conclusionFor('monitor', 'runtime_blocker')).toBe('neutral');
  });

  it('passes a clear deployment in either mode', () => {
    expect(conclusionFor('enforce', 'clear')).toBe('succeeded');
    expect(conclusionFor('monitor', 'clear')).toBe('succeeded');
  });

  it('never holds production for something Assurly could not decide', () => {
    for (const outcome of [
      'ownership_unverified',
      'deployment_protected',
      'probe_refused',
      'probe_unavailable',
    ] as const) {
      expect(conclusionFor('enforce', outcome)).toBe('neutral');
    }
  });
});

describe('isVercelDeploymentUrl', () => {
  it('accepts a generated deployment host', () => {
    expect(isVercelDeploymentUrl('https://app-abc123-team.vercel.app/')).toBe(true);
  });

  it('rejects custom domains, look-alikes and anything with a path or credentials', () => {
    expect(isVercelDeploymentUrl('https://app.example.com/')).toBe(false);
    expect(isVercelDeploymentUrl('https://vercel.app.evil.com/')).toBe(false);
    expect(isVercelDeploymentUrl('https://evilvercel.app/')).toBe(false);
    expect(isVercelDeploymentUrl('http://app.vercel.app/')).toBe(false);
    expect(isVercelDeploymentUrl('https://user:pass@app.vercel.app/')).toBe(false);
    expect(isVercelDeploymentUrl('https://app.vercel.app/admin')).toBe(false);
    expect(isVercelDeploymentUrl('https://app.vercel.app:8443/')).toBe(false);
  });
});

describe('readIntegrationEvent', () => {
  const deployment = {
    id: 'dpl_8tGYeh1Q',
    url: 'app-abc123-team.vercel.app',
    meta: { githubCommitSha: 'ABC1234DEF' },
  };

  it('reads a production deployment event', () => {
    expect(
      readIntegrationEvent({
        type: 'deployment.created',
        payload: {
          deployment,
          project: { id: 'prj_app' },
          team: { id: 'team_1' },
          target: 'production',
        },
      }),
    ).toEqual({
      type: 'deployment.created',
      deploymentId: 'dpl_8tGYeh1Q',
      projectId: 'prj_app',
      teamId: 'team_1',
      production: true,
      deploymentUrl: 'https://app-abc123-team.vercel.app',
      gitSha: 'abc1234def',
    });
  });

  it('marks preview deployments and drops a URL that is not a Vercel host', () => {
    const event = readIntegrationEvent({
      type: 'deployment.ready',
      payload: {
        deployment: { ...deployment, url: 'evil.example.com' },
        project: { id: 'prj_app' },
        target: null,
      },
    });
    expect(event).toMatchObject({ production: false, deploymentUrl: null, teamId: null });
  });

  it('reads a rerun request and an uninstall', () => {
    expect(
      readIntegrationEvent({
        type: 'deployment.check-rerequested',
        payload: { deployment: { id: 'dpl_8tGYeh1Q' }, check: { id: 'check_1' } },
      }),
    ).toEqual({
      type: 'deployment.check-rerequested',
      deploymentId: 'dpl_8tGYeh1Q',
      checkId: 'check_1',
    });
    expect(
      readIntegrationEvent({
        type: 'integration-configuration.removed',
        payload: { configuration: { id: 'icfg_abc' } },
      }),
    ).toEqual({ type: 'integration-configuration.removed', configurationId: 'icfg_abc' });
  });

  it('ignores unknown events and malformed ids', () => {
    expect(readIntegrationEvent({ type: 'project.created', payload: {} })).toEqual({
      type: 'ignored',
    });
    expect(
      readIntegrationEvent({
        type: 'deployment.created',
        payload: { deployment: { id: '../dpl' }, project: { id: 'prj_app' } },
      }),
    ).toEqual({ type: 'ignored' });
    expect(readIntegrationEvent(null)).toEqual({ type: 'ignored' });
  });
});
