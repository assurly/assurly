import { describe, expect, it } from 'vitest';
import { decidePreviewLock, isVercelPreviewUrl, readPreviewDeployment } from './liveLockPreview';

const deployment = {
  projectId: 'prj_owned',
  deploymentId: 'dpl_1',
  target: null,
  previewUrl: 'https://app-git-main-team.vercel.app',
  gitSha: 'abc1234',
};

describe('decidePreviewLock', () => {
  it('ignores a deployment from a different project and does not describe a probe', () => {
    expect(
      decidePreviewLock({
        linkedProjectId: 'prj_owned',
        deployment: { ...deployment, projectId: 'prj_other' },
      }),
    ).toEqual({ action: 'ignore' });
  });

  it('ignores a deployment that is already production', () => {
    expect(
      decidePreviewLock({
        linkedProjectId: 'prj_owned',
        deployment: { ...deployment, target: 'production' },
      }),
    ).toEqual({ action: 'ignore' });
  });

  it('refuses a matching project when the commit is missing', () => {
    expect(
      decidePreviewLock({
        linkedProjectId: 'prj_owned',
        deployment: { ...deployment, gitSha: null },
      }),
    ).toEqual({ action: 'refuse' });
  });

  it('refuses a custom domain even when the project matches', () => {
    expect(
      decidePreviewLock({
        linkedProjectId: 'prj_owned',
        deployment: { ...deployment, previewUrl: 'https://app.example.com' },
      }),
    ).toEqual({ action: 'refuse' });
  });

  it('probes a vercel.app preview of the linked project', () => {
    expect(decidePreviewLock({ linkedProjectId: 'prj_owned', deployment })).toEqual({
      action: 'probe',
      previewUrl: 'https://app-git-main-team.vercel.app',
      gitSha: 'abc1234',
      attemptId: 'dpl_1',
    });
  });
});

describe('isVercelPreviewUrl', () => {
  it('rejects credentials and non-https hosts', () => {
    expect(isVercelPreviewUrl('https://user:pw@app.vercel.app')).toBe(false);
    expect(isVercelPreviewUrl('http://app.vercel.app')).toBe(false);
  });
});

describe('readPreviewDeployment', () => {
  it('reads the commit and project from a Vercel payload', () => {
    expect(
      readPreviewDeployment({
        payload: {
          target: null,
          deployment: {
            id: 'dpl_1',
            url: 'app-git-main-team.vercel.app',
            projectId: 'prj_owned',
            meta: { githubCommitSha: 'ABC1234' },
          },
        },
      }),
    ).toMatchObject({
      projectId: 'prj_owned',
      previewUrl: 'https://app-git-main-team.vercel.app',
      gitSha: 'ABC1234',
    });
  });
});
