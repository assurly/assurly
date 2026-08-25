import type { DbAdapter, ScanFinding, ScanShipGateMeta } from './dbAdapter';
import { generateBadgeToken } from './guardian';
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

function logTargetSyncFailure(
  event: 'target-sync-failed' | 'target-reset-failed' | 'target-sync-stale-mark-failed',
  details: Record<string, unknown>,
  error: unknown,
): void {
  console.error(
    JSON.stringify({
      service: 'assurly-api',
      event,
      ...details,
      errorType: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
    }),
  );
}

/**
 * Recomputes and writes the repo's `target` (the current-verdict projection)
 * from a set of scan findings. Shared by browser POST /api/scans and
 * programmatic POST /api/v1/scans so cards stay on one SoT.
 *
 * Throws on failure so the caller can record a stale projection. Do not let
 * that throw fail the user's scan.
 */
export async function syncRepoTargetVerdict(
  db: Pick<DbAdapter, 'getRepository' | 'getTargetByIdentifier' | 'upsertTarget'>,
  repoId: string,
  input: RepoTargetVerdictInput,
): Promise<void> {
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
  const existing = await db.getTargetByIdentifier(repo.organization_id, 'repo', repo.name);
  const badgeToken = existing?.badge_token ?? generateBadgeToken();
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
    badgeToken,
  });
}

export async function resetRepoTargetToNeutral(db: DbAdapter, repoId: string): Promise<void> {
  try {
    const repo = await db.getRepository(repoId);
    if (!repo) return;
    const existing = await db.getTargetByIdentifier(repo.organization_id, 'repo', repo.name);
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
      badgeToken: existing?.badge_token ?? undefined,
    });
  } catch (error) {
    logTargetSyncFailure('target-reset-failed', { repoId }, error);
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
  try {
    await syncRepoTargetVerdict(db, input.repoId, {
      findings: input.findings as ScanFinding[],
      scannedFileCount: input.meta.scannedFileCount ?? undefined,
      generatorFingerprint: input.generatorFingerprint,
      lastCheckedAt: scan.created_at ?? null,
      shipScoreOverride: input.meta.shipScore ?? undefined,
      verdictOverride: input.meta.verdict ?? undefined,
    });
  } catch (error) {
    logTargetSyncFailure('target-sync-failed', { repoId: input.repoId, scanId: scan.id }, error);
    try {
      await db.markScanProjectionStale(scan.id);
    } catch (markError) {
      logTargetSyncFailure(
        'target-sync-stale-mark-failed',
        { repoId: input.repoId, scanId: scan.id },
        markError,
      );
    }
  }
  return scan;
}
