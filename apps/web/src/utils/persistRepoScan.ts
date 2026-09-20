import type {
  DbAdapter,
  ProbeEvidenceRow,
  Repository,
  ScanFinding,
  ScanShipGateMeta,
} from './dbAdapter';
import { generateBadgeToken } from './guardian';
import { confirmFindingsLive, type LiveProofEvidence } from './liveConfirmation';
import { resolveVerdictFromScanFindings } from './shipGate';
import {
  recordedDefaultBranch,
  scanOwnsRepoVerdict,
  type VerdictOwningScanFields,
} from './verdictOwningScan';

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
  /**
   * When creating a target that has no badge token, mint one. Default true so
   * live scan writes keep today's behaviour. Backfill passes false unless
   * `--mint-badges` is set — minting publishes auth-free URLs.
   */
  mintBadgeIfMissing?: boolean;
}

function logTargetSyncFailure(
  event:
    | 'target-sync-failed'
    | 'target-reset-failed'
    | 'target-sync-stale-mark-failed'
    | 'repo-default-branch-read-failed'
    | 'repo-default-branch-write-failed'
    | 'live-confirmation-failed',
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
  const mintBadge = input.mintBadgeIfMissing !== false;
  const badgeToken = existing?.badge_token ?? (mintBadge ? generateBadgeToken() : undefined);
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

/**
 * Teaches the repository which branch it ships from, from the GitHub default
 * the scan observed while it ran, and returns the branch that ownership should
 * be judged against.
 *
 * This is what retires the main/master guess: one scan of any branch records
 * the real default, and every older scan of that repository is then judged
 * against it too.
 *
 * Best-effort — the column is absent until the migration runs, and a scan must
 * never fail because we could not record a branch name.
 */
async function learnRepoDefaultBranch(
  db: Pick<DbAdapter, 'getRepository' | 'updateRepositoryDefaultBranch'>,
  repoId: string,
  scan: VerdictOwningScanFields,
): Promise<string | null | undefined> {
  const observed = recordedDefaultBranch(scan);
  let repo: Repository | null = null;
  try {
    repo = await db.getRepository(repoId);
  } catch (error) {
    // Ownership then falls back to the main/master guess for this write only.
    logTargetSyncFailure('repo-default-branch-read-failed', { repoId }, error);
  }
  if (!observed) return repo?.default_branch;
  if (repo && repo.default_branch !== observed) {
    try {
      await db.updateRepositoryDefaultBranch(repoId, observed);
    } catch (error) {
      logTargetSyncFailure('repo-default-branch-write-failed', { repoId }, error);
    }
  }
  return observed;
}

function redactedSampleFromRow(sample: unknown): LiveProofEvidence['redactedSample'] {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return undefined;
  const record = sample as Record<string, unknown>;
  const table = typeof record.table === 'string' ? record.table : undefined;
  const path = typeof record.path === 'string' ? record.path : undefined;
  if (!table && !path) return undefined;
  return { table, path };
}

function evidenceFromRows(rows: ProbeEvidenceRow[]): LiveProofEvidence[] {
  return rows.map((row) => ({
    kind: row.kind,
    summary: row.summary,
    redactedSample: redactedSampleFromRow(row.redacted_sample),
  }));
}

/**
 * If this repository is bound to a verified url target, raise confidence on
 * static findings whose subject the latest probe already proved. Read-only —
 * never probes. Failures leave findings untouched.
 */
async function confirmScanFindingsLive(
  db: Pick<
    DbAdapter,
    'getRepository' | 'getTargetByIdentifier' | 'getLatestProbeEvidenceForTarget'
  >,
  repoId: string,
  findings: PersistRepoScanInput['findings'],
): Promise<{ findings: PersistRepoScanInput['findings']; confirmed: number }> {
  try {
    const repo = await db.getRepository(repoId);
    if (!repo?.homepage_url) return { findings, confirmed: 0 };
    const target = await db.getTargetByIdentifier(repo.organization_id, 'url', repo.homepage_url);
    if (!target || !target.ownership_verified) return { findings, confirmed: 0 };
    const rows = await db.getLatestProbeEvidenceForTarget(target.id);
    return confirmFindingsLive(findings, evidenceFromRows(rows), target.identifier);
  } catch (error) {
    logTargetSyncFailure('live-confirmation-failed', { repoId }, error);
    return { findings, confirmed: 0 };
  }
}

/** Persist findings + Ship Gate meta. Sync the repo projection only when this scan owns the verdict. */
export async function persistRepoScan(db: DbAdapter, input: PersistRepoScanInput) {
  const live = await confirmScanFindingsLive(db, input.repoId, input.findings);
  const findings = live.findings;
  let meta = input.meta;
  if (live.confirmed > 0 && input.status !== 'failed') {
    const verdict = resolveVerdictFromScanFindings(findings as ScanFinding[], {
      scannedFileCount: input.meta.scannedFileCount ?? undefined,
    });
    meta = {
      ...input.meta,
      shipScore: verdict.shipScore,
      verdict: verdict.status,
    };
  }
  const errors = findings.filter((finding) => finding.severity === 'error').length;
  const warnings = findings.length - errors;
  const scan = await db.saveScan(
    input.repoId,
    input.commitSha,
    input.branch,
    input.status,
    errors,
    warnings,
    findings,
    meta,
  );
  const scanFields: VerdictOwningScanFields = {
    branch: input.branch,
    scan_scope: input.meta.scanScope,
  };
  const repoDefaultBranch = await learnRepoDefaultBranch(db, input.repoId, scanFields);
  if (!scanOwnsRepoVerdict(scanFields, repoDefaultBranch)) {
    return scan;
  }
  try {
    await syncRepoTargetVerdict(db, input.repoId, {
      findings: findings as ScanFinding[],
      scannedFileCount: meta.scannedFileCount ?? undefined,
      generatorFingerprint: input.generatorFingerprint,
      lastCheckedAt: scan.created_at ?? null,
      shipScoreOverride: meta.shipScore ?? undefined,
      verdictOverride: meta.verdict ?? undefined,
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
