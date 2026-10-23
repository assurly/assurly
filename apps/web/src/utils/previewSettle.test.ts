import { describe, expect, it, vi } from 'vitest';
import type { DbAdapter, Target } from './dbAdapter';
import { settlePreviewDeployment } from './previewSettle';

function target(): Target {
  return {
    id: 'target-1',
    organization_id: 'org-1',
    kind: 'url',
    identifier: 'https://app.example.com',
    display_name: 'App',
    repository_id: null,
    generator_fingerprint: null,
    ownership_verified: true,
    ownership_method: 'dns_txt',
    current_verdict: 'blocked',
    current_ship_score: 59,
    verdict_evidence: null,
    last_checked_at: null,
    badge_token: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  };
}

function db(): DbAdapter {
  return {
    getLiveLockAttempt: vi.fn(async () => null),
    insertLiveLockAttempt: vi.fn(async (input) => ({
      id: 'row-1',
      organization_id: input.organizationId,
      target_id: input.targetId,
      git_sha: input.gitSha,
      attempt_id: input.attemptId,
      status: input.status,
      ship_score: input.shipScore,
      reason: input.reason,
      created_at: '2026-10-23T12:00:00.000Z',
    })),
    upsertTarget: vi.fn(async () => target()),
    getFixOutcomesForTarget: vi.fn(async () => []),
    insertFixOutcomes: vi.fn(async () => undefined),
  } as unknown as DbAdapter;
}

const preview = {
  projectId: 'prj_owned',
  deploymentId: 'dpl_1',
  target: null,
  previewUrl: 'https://app-git-main-team.vercel.app',
  gitSha: 'abc1234',
};

describe('settlePreviewDeployment', () => {
  it('does not fetch or promote a different project', async () => {
    const adapter = db();
    const promote = vi.fn();
    const scanImpl = vi.fn();
    const result = await settlePreviewDeployment({
      target: target(),
      linkedProjectId: 'prj_owned',
      deployment: { ...preview, projectId: 'prj_other' },
      db: adapter,
      promote,
      scanImpl: scanImpl as never,
    });
    expect(result).toBe('ignored');
    expect(scanImpl).not.toHaveBeenCalled();
    expect(promote).not.toHaveBeenCalled();
  });

  it('does not promote when the fresh check is blocked', async () => {
    const adapter = db();
    const promote = vi.fn();
    const scanImpl = vi.fn(async () => ({
      findings: [
        {
          ruleId: 'runtime-supabase-rls-open',
          severity: 'error',
          confidence: 'high',
          message: 'Rows are readable.',
          file: 'runtime',
          suggestion: 'Close it.',
        },
      ],
      evidence: [],
    }));
    const result = await settlePreviewDeployment({
      target: target(),
      linkedProjectId: 'prj_owned',
      deployment: preview,
      db: adapter,
      promote,
      scanImpl: scanImpl as never,
    });
    expect(result).toBe('blocked');
    expect(promote).not.toHaveBeenCalled();
    expect(scanImpl).toHaveBeenCalledOnce();
  });

  it('promotes once when the fresh check is ready', async () => {
    const adapter = db();
    const promote = vi.fn(async () => undefined);
    const scanImpl = vi.fn(async () => ({ findings: [], evidence: [] }));
    const result = await settlePreviewDeployment({
      target: target(),
      linkedProjectId: 'prj_owned',
      deployment: preview,
      db: adapter,
      promote,
      scanImpl: scanImpl as never,
    });
    expect(result).toBe('promoted');
    expect(promote).toHaveBeenCalledOnce();
    expect(promote).toHaveBeenCalledWith('dpl_1');
  });

  it('does not promote when the preview host is refused', async () => {
    const adapter = db();
    const promote = vi.fn();
    const scanImpl = vi.fn();
    const result = await settlePreviewDeployment({
      target: target(),
      linkedProjectId: 'prj_owned',
      deployment: { ...preview, previewUrl: 'https://app.example.com' },
      db: adapter,
      promote,
      scanImpl: scanImpl as never,
    });
    expect(result).toBe('refused');
    expect(scanImpl).not.toHaveBeenCalled();
    expect(promote).not.toHaveBeenCalled();
  });
});
