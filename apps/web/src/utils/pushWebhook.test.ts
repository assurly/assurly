import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbAdapter } from './dbAdapter';

const scanPushedCommit = vi.hoisted(() => vi.fn());
vi.mock('./pushScan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pushScan')>()),
  scanPushedCommit,
}));

import { handlePushDelivery } from './pushWebhook';

const HEAD = 'a'.repeat(40);
const NOW = new Date('2026-10-23T10:00:00.000Z');

function payload(overrides: Record<string, unknown> = {}) {
  return {
    ref: 'refs/heads/main',
    after: HEAD,
    deleted: false,
    repository: { id: 42, full_name: 'tibco87/app', default_branch: 'main' },
    installation: { id: 456 },
    head_commit: { timestamp: '2026-10-23T09:58:00+02:00' },
    ...overrides,
  };
}

const db = {
  getRepositoryByGithubRepoId: vi.fn(),
  getRecentScans: vi.fn(),
  claimGitHubDelivery: vi.fn(),
  recordRepositoryHeadCommit: vi.fn(),
  finishGitHubDelivery: vi.fn(),
};

let scheduled: Array<() => Promise<void>>;

function deliver(rawPayload: unknown, deliveryId: string | null = 'delivery-1') {
  return handlePushDelivery({
    rawPayload,
    deliveryId,
    db: db as unknown as DbAdapter,
    runAfter: (work) => {
      scheduled.push(work);
    },
    now: () => NOW,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  scheduled = [];
  db.getRepositoryByGithubRepoId.mockResolvedValue({
    id: 'repo-1',
    is_active: true,
    scan_capability: 'browser',
  });
  db.getRecentScans.mockResolvedValue([]);
  db.claimGitHubDelivery.mockResolvedValue(true);
  db.recordRepositoryHeadCommit.mockResolvedValue(undefined);
  db.finishGitHubDelivery.mockResolvedValue(undefined);
  scanPushedCommit.mockResolvedValue({
    status: 'scanned',
    scanId: 'scan-1',
    verdict: 'ready',
    shipScore: 100,
  });
});

describe('handlePushDelivery', () => {
  it('records the new head commit before answering, then scans it in the background', async () => {
    expect(await deliver(payload())).toEqual({ status: 202, message: 'Push accepted.' });

    expect(db.claimGitHubDelivery).toHaveBeenCalledWith('delivery-1', 'push', 42, '456');
    expect(db.recordRepositoryHeadCommit).toHaveBeenCalledWith(
      'repo-1',
      HEAD,
      '2026-10-23T07:58:00.000Z',
    );
    expect(scanPushedCommit).not.toHaveBeenCalled();

    await scheduled[0]();
    expect(scanPushedCommit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ id: 'repo-1' }),
      {
        repositoryName: 'tibco87/app',
        githubRepositoryId: 42,
        installationId: '456',
        branch: 'main',
        defaultBranch: 'main',
        commitSha: HEAD,
      },
      null,
      undefined,
    );
    expect(db.finishGitHubDelivery).toHaveBeenCalledWith('delivery-1', true, undefined);
  });

  it.each([
    ['a tag', { ref: 'refs/tags/v1.0.0' }],
    ['a deleted branch', { deleted: true }],
    ['an all-zero commit', { after: '0'.repeat(40) }],
  ])('ignores %s', async (_label, overrides) => {
    expect(await deliver(payload(overrides))).toEqual({ status: 200, message: 'Push ignored.' });
    expect(db.claimGitHubDelivery).not.toHaveBeenCalled();
    expect(db.recordRepositoryHeadCommit).not.toHaveBeenCalled();
  });

  it('ignores a push to a branch the verdict is not about', async () => {
    expect(await deliver(payload({ ref: 'refs/heads/feature/login' }))).toEqual({
      status: 200,
      message: 'Branch not tracked.',
    });
    expect(db.recordRepositoryHeadCommit).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
  });

  it('ignores a repository that is not connected to Assurly', async () => {
    db.getRepositoryByGithubRepoId.mockResolvedValue(null);
    expect((await deliver(payload())).message).toBe('Repository not connected.');
    expect(db.claimGitHubDelivery).not.toHaveBeenCalled();
  });

  it('handles a redelivered push once', async () => {
    db.claimGitHubDelivery.mockResolvedValue(false);
    expect((await deliver(payload())).message).toBe('Duplicate delivery ignored.');
    expect(db.recordRepositoryHeadCommit).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
  });

  it('scans the trunk that stands in for an empty default branch', async () => {
    db.getRecentScans.mockResolvedValue([
      { branch: 'main', scan_scope: { defaultBranch: 'src', emptyDefaultBranch: 'src' } },
    ]);
    await deliver(
      payload({ repository: { id: 42, full_name: 'tibco87/app', default_branch: 'src' } }),
    );
    await scheduled[0]();
    expect(scanPushedCommit.mock.calls[0][3]).toBe('src');
  });

  it('records the commit but skips the scan for an invalid repository', async () => {
    db.getRepositoryByGithubRepoId.mockResolvedValue({
      id: 'repo-1',
      is_active: true,
      scan_capability: 'invalid',
    });
    expect(await deliver(payload())).toEqual({ status: 202, message: 'Head commit recorded.' });
    expect(db.recordRepositoryHeadCommit).toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
    expect(db.finishGitHubDelivery).toHaveBeenCalledWith('delivery-1', true);
  });

  it('falls back to now when the payload carries no commit time', async () => {
    await deliver(payload({ head_commit: null }));
    expect(db.recordRepositoryHeadCommit.mock.calls[0][2]).toBe(NOW.toISOString());
  });

  it('marks the delivery failed when the background scan fails', async () => {
    scanPushedCommit.mockRejectedValue(new Error('GitHub is unavailable.'));
    await deliver(payload());
    await scheduled[0]();
    expect(db.finishGitHubDelivery).toHaveBeenCalledWith(
      'delivery-1',
      false,
      'GitHub is unavailable.',
    );
  });

  it('notes an oversized snapshot without failing the delivery', async () => {
    scanPushedCommit.mockResolvedValue({ status: 'too_large' });
    await deliver(payload());
    await scheduled[0]();
    expect(db.finishGitHubDelivery).toHaveBeenCalledWith(
      'delivery-1',
      true,
      'Snapshot over the Full Gate size limit.',
    );
  });

  it('rejects a malformed delivery id', async () => {
    await expect(deliver(payload(), 'bad id!')).rejects.toThrow('Invalid delivery ID.');
  });
});
