import { describe, expect, it, vi } from 'vitest';
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
});
