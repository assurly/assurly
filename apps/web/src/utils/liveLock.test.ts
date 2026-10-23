import { describe, expect, it, vi } from 'vitest';
import type { ScannerFinding } from '@assurly/scanner-core';
import type { DbAdapter, LiveLockAttemptRow, Target } from './dbAdapter';
import { runLiveLock } from './liveLock';

function target(overrides: Partial<Target> = {}): Target {
  return {
    id: 'target-1',
    organization_id: 'org-1',
    kind: 'url',
    identifier: 'https://app.example.com',
    display_name: 'Example',
    repository_id: null,
    generator_fingerprint: null,
    ownership_verified: true,
    ownership_method: 'dns_txt',
    current_verdict: 'blocked',
    current_ship_score: 59,
    verdict_evidence: null,
    last_checked_at: null,
    badge_token: 'a'.repeat(32),
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function row(overrides: Partial<LiveLockAttemptRow> = {}): LiveLockAttemptRow {
  return {
    id: 'attempt-1',
    organization_id: 'org-1',
    target_id: 'target-1',
    git_sha: 'abc1234',
    attempt_id: 'run-1',
    status: 'blocked',
    ship_score: 59,
    reason: 'runtime_blocker',
    created_at: '2026-10-23T12:00:00.000Z',
    ...overrides,
  };
}

function finding(ruleId: string): ScannerFinding {
  return {
    ruleId,
    severity: 'error',
    confidence: 'high',
    message: 'Rows are readable.',
    file: 'runtime',
    suggestion: 'Close the table.',
  };
}

function adapter(existing: LiveLockAttemptRow | null = null): DbAdapter {
  const inserted: LiveLockAttemptRow[] = [];
  return {
    getLiveLockAttempt: vi.fn(async () => existing),
    insertLiveLockAttempt: vi.fn(async (input) => {
      const stored = row({
        git_sha: input.gitSha,
        attempt_id: input.attemptId,
        status: input.status,
        ship_score: input.shipScore,
        reason: input.reason,
      });
      inserted.push(stored);
      return stored;
    }),
    upsertTarget: vi.fn(async () => target()),
    getFixOutcomesForTarget: vi.fn(async () => []),
    insertFixOutcomes: vi.fn(async () => undefined),
    replaceProbeEvidenceForTarget: undefined,
  } as unknown as DbAdapter;
}

describe('runLiveLock', () => {
  it('returns the stored attempt and does not probe again', async () => {
    const db = adapter(row({ status: 'ready', reason: 'clear', ship_score: 100 }));
    const scanImpl = vi.fn();
    const result = await runLiveLock({
      target: target(),
      gitSha: 'ABC1234',
      attemptId: 'run-1',
      db,
      scanImpl: scanImpl as never,
    });
    expect(result.status).toBe('ready');
    expect(result.fresh).toBe(false);
    expect(scanImpl).not.toHaveBeenCalled();
    expect(db.insertLiveLockAttempt).not.toHaveBeenCalled();
  });

  it('blocks an unverified URL without calling the scanner', async () => {
    const db = adapter();
    const scanImpl = vi.fn();
    const result = await runLiveLock({
      target: target({ ownership_verified: false }),
      gitSha: 'abc1234',
      attemptId: 'run-2',
      db,
      scanImpl: scanImpl as never,
    });
    expect(result).toMatchObject({
      status: 'blocked',
      shipScore: 0,
      reason: 'ownership_unverified',
      fresh: true,
    });
    expect(scanImpl).not.toHaveBeenCalled();
  });

  it('caps the score at 59 when the fresh probe still has a blocker', async () => {
    const db = adapter();
    const scanImpl = vi.fn(async () => ({
      findings: [finding('runtime-supabase-rls-open')],
      evidence: [],
      blocked: undefined,
    }));
    const result = await runLiveLock({
      target: target(),
      gitSha: 'abc1234',
      attemptId: 'run-3',
      db,
      scanImpl: scanImpl as never,
    });
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('runtime_blocker');
    expect(result.shipScore).toBeLessThanOrEqual(59);
  });

  it('does not fetch when the preview project does not match', async () => {
    const db = adapter();
    const scanImpl = vi.fn();
    const result = await runLiveLock({
      target: target(),
      gitSha: 'abc1234',
      attemptId: 'dpl_other',
      db,
      scanImpl: scanImpl as never,
      preview: {
        projectId: 'prj_owned',
        deploymentProjectId: 'prj_other',
        previewUrl: 'https://other.vercel.app',
      },
    });
    expect(result).toMatchObject({ status: 'blocked', reason: 'probe_refused' });
    expect(scanImpl).not.toHaveBeenCalled();
    expect(db.insertLiveLockAttempt).not.toHaveBeenCalled();
  });

  it('is ready only when the fresh probe has no blocker', async () => {
    const db = adapter();
    const scanImpl = vi.fn(async () => ({
      findings: [],
      evidence: [],
      blocked: undefined,
    }));
    const result = await runLiveLock({
      target: target(),
      gitSha: 'abc1234',
      attemptId: 'run-4',
      db,
      scanImpl: scanImpl as never,
    });
    expect(result).toMatchObject({ status: 'ready', reason: 'clear', shipScore: 100 });
  });
});
