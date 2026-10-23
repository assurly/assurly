import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbAdapter } from './dbAdapter';
import { TarballTooLargeError } from './githubTarball';
import {
  prioritizeFindings,
  scanPushedCommit,
  trackedBranch,
  type PushEvent,
  type PushScanDeps,
} from './pushScan';
import { tarGz, type TarFixtureEntry } from './tarGzTestFixture';

const HEAD = 'a'.repeat(40);
const ROOT = 'tibco87-app-aaaaaaa';
const REPO_ID = 'repo-1';
const BROKEN_PROJECT = path.resolve(__dirname, '../../../../test-projects/broken-project');

const EVENT: PushEvent = {
  repositoryName: 'tibco87/app',
  githubRepositoryId: 42,
  installationId: '456',
  branch: 'main',
  defaultBranch: 'main',
  commitSha: HEAD,
};

function fixtureArchive(directory: string): Buffer {
  const entries: TarFixtureEntry[] = [];
  const walk = (current: string): void => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name !== '.DS_Store') {
        entries.push({
          name: `${ROOT}/${path.relative(directory, full)}`,
          content: fs.readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(directory);
  return tarGz(entries);
}

function makeDb(headCommitSha: string | null = HEAD) {
  return {
    getRepository: vi.fn().mockResolvedValue({
      id: REPO_ID,
      organization_id: 'org-1',
      name: 'tibco87/app',
      default_branch: 'main',
      head_commit_sha: headCommitSha,
      homepage_url: null,
    }),
    getTargetByIdentifier: vi.fn().mockResolvedValue(null),
    getLatestProbeEvidenceForTarget: vi.fn().mockResolvedValue([]),
    saveScan: vi.fn().mockImplementation(async (...args: unknown[]) => ({
      id: 'scan-new',
      created_at: '2026-10-23T10:00:00.000Z',
      ship_score: (args[7] as { shipScore: number | null }).shipScore,
      verdict: (args[7] as { verdict: string }).verdict,
    })),
    updateRepositoryDefaultBranch: vi.fn().mockResolvedValue(undefined),
    upsertTarget: vi.fn().mockResolvedValue({}),
    markScanProjectionStale: vi.fn().mockResolvedValue(undefined),
  };
}

describe('trackedBranch', () => {
  it('tracks a push to the default branch', () => {
    expect(trackedBranch({ branch: 'main', defaultBranch: 'main' }, [])).toEqual({
      tracked: true,
      emptyDefaultBranch: null,
    });
  });

  it('ignores feature and fix branches', () => {
    expect(trackedBranch({ branch: 'feature/login', defaultBranch: 'main' }, []).tracked).toBe(
      false,
    );
    expect(
      trackedBranch({ branch: 'assurly-fix-0123456789ab', defaultBranch: 'main' }, []).tracked,
    ).toBe(false);
  });

  it('tracks the trunk that stands in for an empty default (Anima: src → main)', () => {
    const scans = [
      { branch: 'main', scan_scope: { defaultBranch: 'src', emptyDefaultBranch: 'src' } },
      { branch: 'src', scan_scope: { defaultBranch: 'src' } },
    ];
    expect(trackedBranch({ branch: 'main', defaultBranch: 'src' }, scans)).toEqual({
      tracked: true,
      emptyDefaultBranch: 'src',
    });
  });

  it('stops tracking the stand-in once the default branch has its own verdict', () => {
    const scans = [
      { branch: 'src', scan_scope: { defaultBranch: 'src' } },
      { branch: 'main', scan_scope: { defaultBranch: 'src', emptyDefaultBranch: 'src' } },
    ];
    expect(trackedBranch({ branch: 'main', defaultBranch: 'src' }, scans).tracked).toBe(false);
  });
});

describe('prioritizeFindings', () => {
  it('keeps every error ahead of warnings and caps at the persisted limit', () => {
    const findings = [
      ...Array.from({ length: 150 }, () => ({
        ruleId: 'undocumented-env',
        severity: 'warning' as const,
        message: 'w',
      })),
      { ruleId: 'supabase-rls', severity: 'error' as const, message: 'e' },
    ];
    const kept = prioritizeFindings(findings);
    expect(kept).toHaveLength(100);
    expect(kept[0].severity).toBe('error');
  });
});

describe('scanPushedCommit', () => {
  let deps: PushScanDeps;
  let scannedDirectory: string | null;

  beforeEach(() => {
    scannedDirectory = null;
    deps = {
      getToken: vi.fn().mockResolvedValue('installation-token'),
      download: vi
        .fn()
        .mockResolvedValue(tarGz([{ name: `${ROOT}/package.json`, content: '{"name":"app"}' }])),
      scanDirectory: vi.fn().mockImplementation(async (directory: string) => {
        scannedDirectory = directory;
        expect(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).toBe(
          '{"name":"app"}',
        );
        return {
          findings: [],
          report: {
            shipScore: 100,
            status: 'ready',
            scannedFileCount: 1,
            cleanFileCount: 1,
            scanScope: { scanned: 1, skipped: 0, roots: ['repository'] },
          },
        } as never;
      }),
    };
  });

  it('scans that exact commit and stores a push verdict that owns the card', async () => {
    const db = makeDb();
    const outcome = await scanPushedCommit(
      db as unknown as DbAdapter,
      { id: REPO_ID },
      EVENT,
      null,
      deps,
    );

    expect(outcome).toEqual({
      status: 'scanned',
      scanId: 'scan-new',
      verdict: 'ready',
      shipScore: 100,
    });
    expect(deps.getToken).toHaveBeenCalledWith('456', 42);
    expect(deps.download).toHaveBeenCalledWith('tibco87/app', HEAD, 'installation-token');
    const [repoId, commitSha, branch, , , , , meta] = db.saveScan.mock.calls[0];
    expect([repoId, commitSha, branch]).toEqual([REPO_ID, HEAD, 'main']);
    expect(meta.scanScope).toMatchObject({ source: 'push', defaultBranch: 'main' });
    expect(db.upsertTarget).toHaveBeenCalledWith(
      expect.objectContaining({ currentVerdict: 'ready', currentShipScore: 100 }),
    );
  });

  it('deletes the snapshot after the scan', async () => {
    await scanPushedCommit(makeDb() as unknown as DbAdapter, { id: REPO_ID }, EVENT, null, deps);
    expect(scannedDirectory).not.toBeNull();
    expect(fs.existsSync(scannedDirectory as string)).toBe(false);
  });

  it('marks a stand-in scan so it keeps owning the verdict of an empty default', async () => {
    const db = makeDb();
    await scanPushedCommit(
      db as unknown as DbAdapter,
      { id: REPO_ID },
      { ...EVENT, defaultBranch: 'src' },
      'src',
      deps,
    );
    expect(db.saveScan.mock.calls[0][7].scanScope).toMatchObject({
      source: 'push',
      defaultBranch: 'src',
      emptyDefaultBranch: 'src',
    });
  });

  it('never lets an older commit overwrite a newer push that landed meanwhile', async () => {
    const db = makeDb('b'.repeat(40));
    const outcome = await scanPushedCommit(
      db as unknown as DbAdapter,
      { id: REPO_ID },
      EVENT,
      null,
      deps,
    );
    expect(outcome).toEqual({ status: 'superseded' });
    expect(db.saveScan).not.toHaveBeenCalled();
  });

  it('records nothing for a snapshot over the size limit', async () => {
    deps.download = vi.fn().mockRejectedValue(new TarballTooLargeError('too big'));
    const db = makeDb();
    expect(
      await scanPushedCommit(db as unknown as DbAdapter, { id: REPO_ID }, EVENT, null, deps),
    ).toEqual({ status: 'too_large' });
    expect(db.saveScan).not.toHaveBeenCalled();
  });

  it('cleans up and rethrows when the engine fails', async () => {
    deps.scanDirectory = vi.fn().mockImplementation(async (directory: string) => {
      scannedDirectory = directory;
      throw new Error('engine crashed');
    });
    await expect(
      scanPushedCommit(makeDb() as unknown as DbAdapter, { id: REPO_ID }, EVENT, null, deps),
    ).rejects.toThrow('engine crashed');
    expect(fs.existsSync(scannedDirectory as string)).toBe(false);
  });

  it('runs the real Full Gate engine on a pushed snapshot (broken-project fixture)', async () => {
    const db = makeDb();
    const outcome = await scanPushedCommit(
      db as unknown as DbAdapter,
      { id: REPO_ID },
      EVENT,
      null,
      {
        getToken: vi.fn().mockResolvedValue('installation-token'),
        download: vi.fn().mockResolvedValue(fixtureArchive(BROKEN_PROJECT)),
        scanDirectory: async (directory) => {
          const { scanProjectDirectory } = await import('assurly/scanProject');
          return scanProjectDirectory(directory);
        },
      },
    );

    expect(outcome).toMatchObject({ status: 'scanned', verdict: 'blocked' });
    const persistedFindings = db.saveScan.mock.calls[0][6] as { rule_id: string }[];
    expect(persistedFindings.length).toBeGreaterThan(0);
    // The same project reads NOT READY TO SHIP from `npx assurly scan`.
    expect(db.saveScan.mock.calls[0][7].verdict).toBe('blocked');
    expect(fs.readdirSync(os.tmpdir()).some((name) => name.startsWith('assurly-push-'))).toBe(
      false,
    );
  }, 60_000);
});
