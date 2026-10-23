import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ScanProjectResult } from 'assurly/scanProject';
import type { DbAdapter, Repository, Scan } from './dbAdapter';
import { persistFullGateScan, type FullGateFinding } from './fullGatePersist';
import { getInstallationAccessToken } from './githubApp';
import {
  downloadCommitTarball,
  readTarGz,
  TarballTooLargeError,
  writeEntries,
} from './githubTarball';
import { PERSISTED_FINDINGS_LIMIT } from './scanGateAuthority';
import { emptyDefaultBranchOf, selectVerdictOwningScan } from './verdictOwningScan';

export interface PushEvent {
  repositoryName: string;
  githubRepositoryId: number;
  installationId: string;
  /** Branch the push landed on, without `refs/heads/`. */
  branch: string;
  /** GitHub's default branch for the repository, from the push payload. */
  defaultBranch: string;
  commitSha: string;
}

/**
 * Whether a push lands on the code the repository's verdict is about: its
 * default branch, or the trunk Assurly scans in place of an empty default
 * (Anima's README-only `src` with the app on `main`). Returns the default it
 * stands in for, so the new scan keeps owning the verdict.
 */
export function trackedBranch(
  event: Pick<PushEvent, 'branch' | 'defaultBranch'>,
  recentScans: readonly Pick<Scan, 'branch' | 'scan_scope'>[],
): { tracked: boolean; emptyDefaultBranch: string | null } {
  if (event.branch === event.defaultBranch) return { tracked: true, emptyDefaultBranch: null };
  const owning = selectVerdictOwningScan(recentScans, event.defaultBranch);
  if (
    owning &&
    owning.branch === event.branch &&
    emptyDefaultBranchOf(owning) === event.defaultBranch
  ) {
    return { tracked: true, emptyDefaultBranch: event.defaultBranch };
  }
  return { tracked: false, emptyDefaultBranch: null };
}

/** Errors first, then the rest, capped like `npx assurly scan --submit` caps them. */
export function prioritizeFindings(findings: readonly FullGateFinding[]): FullGateFinding[] {
  const rank = (severity: FullGateFinding['severity']): number => (severity === 'error' ? 0 : 1);
  return [...findings]
    .sort((left, right) => rank(left.severity) - rank(right.severity))
    .slice(0, PERSISTED_FINDINGS_LIMIT);
}

export interface PushScanDeps {
  getToken: typeof getInstallationAccessToken;
  download: typeof downloadCommitTarball;
  scanDirectory: (directory: string) => Promise<ScanProjectResult>;
}

async function defaultScanDirectory(directory: string): Promise<ScanProjectResult> {
  // The CLI engine pulls in ts-morph; load it only when a push scan runs.
  const { scanProjectDirectory } = await import('assurly/scanProject');
  return scanProjectDirectory(directory);
}

const DEFAULT_DEPS: PushScanDeps = {
  getToken: getInstallationAccessToken,
  download: downloadCommitTarball,
  scanDirectory: defaultScanDirectory,
};

export type PushScanOutcome =
  | { status: 'scanned'; scanId: string; verdict: string; shipScore: number | null }
  | { status: 'too_large' }
  | { status: 'superseded' };

/**
 * Full Gate on the pushed commit: the same engine as `npx assurly scan`,
 * reading every file of that commit rather than Instant Gate's 400. The
 * snapshot lives in a temp directory for the length of the scan only — source
 * is never stored, and only findings reach the database.
 *
 * A snapshot past the size limit records nothing: the card keeps its last
 * verdict and, because the head commit moved, already reads as out of date.
 */
export async function scanPushedCommit(
  db: DbAdapter,
  repository: Pick<Repository, 'id'>,
  event: PushEvent,
  emptyDefaultBranch: string | null,
  deps: PushScanDeps = DEFAULT_DEPS,
): Promise<PushScanOutcome> {
  const token = await deps.getToken(event.installationId, event.githubRepositoryId);
  let directory: string | null = null;
  try {
    const archive = await deps.download(event.repositoryName, event.commitSha, token);
    const entries = readTarGz(archive);
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'assurly-push-'));
    await writeEntries(entries, directory);
    const result = await deps.scanDirectory(directory);

    // Two quick pushes scan in parallel. If a newer commit landed while this
    // one was scanning, its verdict must not be replaced by this older one.
    const current = await db.getRepository(repository.id);
    if (current?.head_commit_sha && current.head_commit_sha !== event.commitSha) {
      return { status: 'superseded' };
    }

    const persisted = await persistFullGateScan(db, {
      repoId: repository.id,
      commitSha: event.commitSha,
      branch: event.branch,
      claim: { shipScore: result.report.shipScore, verdict: result.report.status },
      scannedFileCount: result.report.scannedFileCount,
      cleanFileCount: result.report.cleanFileCount,
      scanScope: {
        ...(result.report.scanScope ?? {}),
        source: 'push',
        defaultBranch: event.defaultBranch,
        ...(emptyDefaultBranch ? { emptyDefaultBranch } : {}),
      },
      findings: prioritizeFindings(result.findings),
      route: 'github:webhook:push',
    });
    return {
      status: 'scanned',
      scanId: persisted.scan.id,
      verdict: persisted.verdict,
      shipScore: persisted.shipScore,
    };
  } catch (error) {
    if (error instanceof TarballTooLargeError) return { status: 'too_large' };
    throw error;
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}
