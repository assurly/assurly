import type { DbAdapter, ScanFinding, ScanShipGateMeta } from './dbAdapter';
import { resolveVerdictFromScanFindings } from './shipGate';

export interface PersistRepoScanInput {
  repoId: string;
  commitSha: string;
  branch: string;
  status: 'success' | 'failed';
  findings: Omit<ScanFinding, 'id' | 'scan_id' | 'created_at'>[];
  meta: ScanShipGateMeta;
  generatorFingerprint?: string;
}

export interface RepoTargetVerdictInput {
  findings: ScanFinding[];
  scannedFileCount?: number;
  generatorFingerprint?: string;
  lastCheckedAt: string | null;
  shipScoreOverride?: number;
  verdictOverride?: 'ready' | 'review' | 'blocked' | 'failed';
}

/**
 * Recomputes and writes the repo's `target` (the current-verdict projection)
 * from a set of scan findings. Shared by browser POST /api/scans and
 * programmatic POST /api/v1/scans so cards stay on one SoT.
 */
export async function syncRepoTargetVerdict(
  db: DbAdapter,
  repoId: string,
  input: RepoTargetVerdictInput,
): Promise<void> {
  try {
    const repo = await db.getRepository(repoId);
    if (!repo) return;
    const verdict = resolveVerdictFromScanFindings(input.findings, {
      scannedFileCount: input.scannedFileCount,
    });
    const currentVerdict =
      input.verdictOverride && input.verdictOverride !== 'failed'
        ? input.verdictOverride
        : input.verdictOverride === 'failed'
          ? 'unknown'
          : verdict.status;
    const currentShipScore =
      input.verdictOverride === 'failed' ? null : (input.shipScoreOverride ?? verdict.shipScore);
    await db.upsertTarget({
      organizationId: repo.organization_id,
      kind: 'repo',
      identifier: repo.name,
      displayName: repo.name,
      repositoryId: repo.id,
      generatorFingerprint: input.generatorFingerprint ?? undefined,
      currentVerdict,
      currentShipScore,
      verdictEvidence: {
        topIssue: input.verdictOverride === 'failed' ? null : verdict.topIssue,
        blockerCount: verdict.blockerCount,
        reviewCount: verdict.reviewCount,
        warningCount: verdict.warningCount,
        headline: verdict.headline,
      },
      lastCheckedAt: input.lastCheckedAt ?? new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to sync target from scan:', error);
  }
}

export async function resetRepoTargetToNeutral(db: DbAdapter, repoId: string): Promise<void> {
  try {
    const repo = await db.getRepository(repoId);
    if (!repo) return;
    await db.upsertTarget({
      organizationId: repo.organization_id,
      kind: 'repo',
      identifier: repo.name,
      displayName: repo.name,
      repositoryId: repo.id,
      currentVerdict: 'unknown',
      currentShipScore: null,
      verdictEvidence: {},
      lastCheckedAt: null,
    });
  } catch (error) {
    console.error('Failed to reset target after deleting the last scan:', error);
  }
}

/** Persist findings + Ship Gate meta and sync the dashboard card projection. */
export async function persistRepoScan(db: DbAdapter, input: PersistRepoScanInput) {
  const errors = input.findings.filter((finding) => finding.severity === 'error').length;
  const warnings = input.findings.length - errors;
  const scan = await db.saveScan(
    input.repoId,
    input.commitSha,
    input.branch,
    input.status,
    errors,
    warnings,
    input.findings,
    input.meta,
  );
  await syncRepoTargetVerdict(db, input.repoId, {
    findings: input.findings as ScanFinding[],
    scannedFileCount: input.meta.scannedFileCount ?? undefined,
    generatorFingerprint: input.generatorFingerprint,
    lastCheckedAt: scan.created_at ?? null,
    shipScoreOverride: input.meta.shipScore ?? undefined,
    verdictOverride: input.meta.verdict ?? undefined,
  });
  return scan;
}
