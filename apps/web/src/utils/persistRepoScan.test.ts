import { describe, expect, it, vi } from 'vitest';
import { SUPABASE_MUTATION_TIMEOUT_MS } from './dbAdapter';
import { persistRepoScan } from './persistRepoScan';

describe('persistRepoScan', () => {
  it('writes Ship Gate SoT meta and syncs the target card score', async () => {
    const db = {
      saveScan: vi.fn().mockResolvedValue({
        id: 'scan-1',
        repository_id: 'repo-1',
        created_at: '2026-08-10T00:00:00.000Z',
      }),
      getRepository: vi.fn().mockResolvedValue({
        id: 'repo-1',
        organization_id: 'org-1',
        name: 'acme/saas',
      }),
      getTargetByIdentifier: vi.fn().mockResolvedValue(null),
      updateRepositoryDefaultBranch: vi.fn().mockResolvedValue(undefined),
      upsertTarget: vi.fn().mockResolvedValue({}),
    };

    const scan = await persistRepoScan(db as never, {
      repoId: 'repo-1',
      commitSha: 'abc',
      branch: 'main',
      status: 'success',
      findings: [],
      meta: {
        shipScore: 96,
        verdict: 'ready',
        scannedFileCount: 12,
        cleanFileCount: 12,
        scanScope: { scanned: 12, skipped: 0, roots: ['.'] },
      },
    });

    expect(scan.id).toBe('scan-1');
    expect(db.saveScan).toHaveBeenCalledWith(
      'repo-1',
      'abc',
      'main',
      'success',
      0,
      0,
      [],
      expect.objectContaining({ shipScore: 96, verdict: 'ready', scannedFileCount: 12 }),
    );
    expect(db.upsertTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        currentShipScore: 96,
        currentVerdict: 'ready',
        repositoryId: 'repo-1',
        badgeToken: expect.stringMatching(/^[a-f0-9]{32}$/),
      }),
    );
  });

  it('projects a failed empty scan as unscanned with a null score', async () => {
    const db = {
      saveScan: vi.fn().mockResolvedValue({
        id: 'scan-fail',
        repository_id: 'repo-1',
        created_at: '2026-08-10T00:00:00.000Z',
      }),
      getRepository: vi.fn().mockResolvedValue({
        id: 'repo-1',
        organization_id: 'org-1',
        name: 'acme/saas',
      }),
      getTargetByIdentifier: vi.fn().mockResolvedValue(null),
      updateRepositoryDefaultBranch: vi.fn().mockResolvedValue(undefined),
      upsertTarget: vi.fn().mockResolvedValue({}),
    };

    await persistRepoScan(db as never, {
      repoId: 'repo-1',
      commitSha: 'abc',
      branch: 'src',
      status: 'failed',
      findings: [],
      meta: {
        shipScore: null,
        verdict: 'failed',
        scannedFileCount: 0,
        cleanFileCount: 0,
        failureReason: 'no_eligible_files',
        scanScope: { scanned: 0, defaultBranch: 'src' },
      },
    });

    expect(db.upsertTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        currentShipScore: null,
        currentVerdict: 'unknown',
        repositoryId: 'repo-1',
      }),
    );
  });

  it.each(['db down', `Supabase request timed out after ${SUPABASE_MUTATION_TIMEOUT_MS}ms`])(
    'keeps the scan when target sync fails (%s) and records that the projection is stale',
    async (message) => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const db = {
        saveScan: vi.fn().mockResolvedValue({
          id: 'scan-ok',
          repository_id: 'repo-1',
          created_at: '2026-08-10T00:00:00.000Z',
          scan_scope: { scanned: 12 },
        }),
        getRepository: vi.fn().mockResolvedValue({
          id: 'repo-1',
          organization_id: 'org-1',
          name: 'acme/saas',
        }),
        getTargetByIdentifier: vi.fn().mockResolvedValue(null),
        upsertTarget: vi.fn().mockRejectedValue(new Error(message)),
        markScanProjectionStale: vi.fn().mockResolvedValue(undefined),
      };

      const scan = await persistRepoScan(db as never, {
        repoId: 'repo-1',
        commitSha: 'abc',
        branch: 'main',
        status: 'success',
        findings: [],
        meta: {
          shipScore: 96,
          verdict: 'ready',
          scannedFileCount: 12,
          cleanFileCount: 12,
        },
      });

      expect(scan.id).toBe('scan-ok');
      expect(db.markScanProjectionStale).toHaveBeenCalledWith('scan-ok');
      expect(errorSpy).toHaveBeenCalled();
      const logged = errorSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(logged).toContain('target-sync-failed');
      expect(logged).toContain('repo-1');
      expect(logged).toContain(message);
      errorSpy.mockRestore();
    },
  );

  it('does not sync the repository projection from a feature-branch scan', async () => {
    const db = {
      saveScan: vi.fn().mockResolvedValue({
        id: 'scan-pr',
        repository_id: 'repo-1',
        created_at: '2026-08-10T00:00:00.000Z',
      }),
      getRepository: vi.fn().mockResolvedValue({
        id: 'repo-1',
        organization_id: 'org-1',
        name: 'acme/saas',
      }),
      getTargetByIdentifier: vi.fn().mockResolvedValue(null),
      updateRepositoryDefaultBranch: vi.fn().mockResolvedValue(undefined),
      upsertTarget: vi.fn().mockResolvedValue({}),
    };

    await persistRepoScan(db as never, {
      repoId: 'repo-1',
      commitSha: 'abc',
      branch: 'feat/login',
      status: 'success',
      findings: [],
      meta: {
        shipScore: 10,
        verdict: 'ready',
        scannedFileCount: 4,
        cleanFileCount: 4,
        scanScope: { scanned: 4, defaultBranch: 'main' },
      },
    });

    expect(db.saveScan).toHaveBeenCalled();
    expect(db.upsertTarget).not.toHaveBeenCalled();
  });

  it('syncs the projection from a CLI Full Gate scan that omitted a git branch', async () => {
    const db = {
      saveScan: vi.fn().mockResolvedValue({
        id: 'scan-cli',
        repository_id: 'repo-1',
        created_at: '2026-08-10T00:00:00.000Z',
      }),
      getRepository: vi.fn().mockResolvedValue({
        id: 'repo-1',
        organization_id: 'org-1',
        name: 'acme/saas',
      }),
      getTargetByIdentifier: vi.fn().mockResolvedValue(null),
      updateRepositoryDefaultBranch: vi.fn().mockResolvedValue(undefined),
      upsertTarget: vi.fn().mockResolvedValue({}),
    };

    await persistRepoScan(db as never, {
      repoId: 'repo-1',
      commitSha: 'cli',
      branch: 'local',
      status: 'success',
      findings: [],
      meta: {
        shipScore: 72,
        verdict: 'review',
        scannedFileCount: 400,
        cleanFileCount: 390,
      },
    });

    expect(db.upsertTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        currentShipScore: 72,
        currentVerdict: 'review',
        repositoryId: 'repo-1',
      }),
    );
  });
});

/**
 * Until a repository records the branch it ships from, ownership falls back to
 * guessing main/master — wrong for every repo that ships from something else.
 * One scan of any branch teaches it, and the answer then applies to that
 * repository's older scans too.
 */
describe('persistRepoScan default-branch learning', () => {
  function dbDouble(repo: Partial<{ default_branch: string | null }> = {}) {
    return {
      saveScan: vi.fn().mockResolvedValue({
        id: 'scan-1',
        repository_id: 'repo-1',
        created_at: '2026-09-01T00:00:00.000Z',
      }),
      getRepository: vi.fn().mockResolvedValue({
        id: 'repo-1',
        organization_id: 'org-1',
        name: 'tibco87/Anima',
        ...repo,
      }),
      getTargetByIdentifier: vi.fn().mockResolvedValue(null),
      updateRepositoryDefaultBranch: vi.fn().mockResolvedValue(undefined),
      upsertTarget: vi.fn().mockResolvedValue({}),
    };
  }

  const scanInput = (branch: string, scanScope: Record<string, unknown>) => ({
    repoId: 'repo-1',
    commitSha: 'abc',
    branch,
    status: 'success' as const,
    findings: [],
    meta: { shipScore: 96, verdict: 'ready' as const, scannedFileCount: 12, scanScope },
  });

  it('records the default branch the scan observed on GitHub', async () => {
    const db = dbDouble();
    await persistRepoScan(db as never, scanInput('src', { scanned: 12, defaultBranch: 'src' }));
    expect(db.updateRepositoryDefaultBranch).toHaveBeenCalledWith('repo-1', 'src');
    expect(db.upsertTarget).toHaveBeenCalled();
  });

  it('does not rewrite a default branch that already matches', async () => {
    const db = dbDouble({ default_branch: 'src' });
    await persistRepoScan(db as never, scanInput('src', { scanned: 12, defaultBranch: 'src' }));
    expect(db.updateRepositoryDefaultBranch).not.toHaveBeenCalled();
    expect(db.upsertTarget).toHaveBeenCalled();
  });

  it('refuses a main-branch scan the projection for a repo that ships from src', async () => {
    const db = dbDouble({ default_branch: 'src' });
    await persistRepoScan(db as never, scanInput('main', { scanned: 12 }));
    expect(db.saveScan).toHaveBeenCalled();
    expect(db.upsertTarget).not.toHaveBeenCalled();
  });

  it('keeps the scan when the repository cannot be read', async () => {
    const db = dbDouble();
    db.getRepository = vi.fn().mockRejectedValue(new Error('Supabase request timed out'));
    const scan = await persistRepoScan(db as never, scanInput('src', { scanned: 12 }));
    expect(scan.id).toBe('scan-1');
    expect(db.updateRepositoryDefaultBranch).not.toHaveBeenCalled();
  });

  it('keeps the scan when recording the branch fails', async () => {
    const db = dbDouble();
    db.updateRepositoryDefaultBranch = vi.fn().mockRejectedValue(new Error('column missing'));
    const scan = await persistRepoScan(
      db as never,
      scanInput('src', { scanned: 12, defaultBranch: 'src' }),
    );
    expect(scan.id).toBe('scan-1');
    expect(db.upsertTarget).toHaveBeenCalled();
  });
});
