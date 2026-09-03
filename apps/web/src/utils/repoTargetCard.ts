import type {
  DbAdapter,
  LatestScanSummary,
  Repository,
  RepositoryScanCapability,
  Target,
  TargetVerdict,
} from './dbAdapter';
import { isGitHubRepositoryName } from './githubApp';
import type { VerdictEvidenceShape } from './publicTrust';
import { resolveVerdictFromScanFindings, type Verdict } from './shipGate';
import { indicatesIncompleteCoverage, resolveDisplayedShipScore } from './shipScoreDisplay';
import { scanOwnsRepoVerdict, selectVerdictOwningScan } from './verdictOwningScan';

/**
 * One app's current safety verdict for the dashboard. This is the object the
 * product leads with — "can I ship this right now?" at a glance — replacing the
 * raw repo list as the primary surface (Phase 1 of the genius rebuild).
 */
export interface TargetCard {
  /** Stable id: the target row id when synced, else a repo-derived key. */
  id: string;
  kind: 'repo' | 'url';
  identifier: string;
  displayName: string;
  repositoryId: string | null;
  generatorFingerprint: string | null;
  verdict: TargetVerdict;
  shipScore: number | null;
  topIssue: Verdict['topIssue'];
  /** When the app was last checked (latest scan / guardian time), or null if never. */
  lastCheckedAt: string | null;
  /** Latest scan id, for opening the detail view (repo targets). */
  latestScanId: string | null;
  ownershipVerified: boolean;
  /** Continuous Guardian is watching this app (ownership-verified url, or connected repo). */
  guardianEnabled: boolean;
  /** True when the ship score dropped since the previous guardian/scan check. */
  scoreDropped: boolean;
  /** Public badge token when available (for embed copy). */
  badgeToken: string | null;
  /** Repo-only capability for Unscanned hygiene / CLI-only cards. */
  scanCapability: RepositoryScanCapability;
  /** True when the latest persisted scan failed before producing a verdict. */
  lastScanFailed: boolean;
  lastScanFailureReason: string | null;
}

export type RepoTargetCardDb = Pick<DbAdapter, 'getRecentScans' | 'getScanFindings'>;

function resolveRepoScanCapability(repo: Repository): RepositoryScanCapability {
  if (!isGitHubRepositoryName(repo.name)) return 'invalid';
  if (repo.scan_capability === 'cli_only' || repo.scan_capability === 'invalid') {
    return repo.scan_capability;
  }
  return 'browser';
}

export function scoreDroppedFromEvidence(
  evidence: VerdictEvidenceShape,
  currentScore: number | null,
): boolean {
  const previous = evidence.previousShipScore;
  if (previous == null || currentScore == null) return false;
  return currentScore < previous;
}

function isFailedLatestScan(latest: LatestScanSummary | null | undefined): boolean {
  if (!latest) return false;
  return latest.verdict === 'failed' || Boolean(latest.failure_reason);
}

function cardFromTargetRow(
  target: Target,
  repo: Repository,
  latest: LatestScanSummary | null,
): TargetCard {
  const evidence = (target.verdict_evidence ?? {}) as VerdictEvidenceShape;
  const topIssue = evidence.topIssue ?? null;
  const incomplete = indicatesIncompleteCoverage({
    topIssueKey: topIssue?.key,
    topIssueLabel: topIssue?.label,
  });
  const failed = isFailedLatestScan(latest);
  const shipScore = failed
    ? null
    : resolveDisplayedShipScore(
        latest ?? {
          ship_score: target.current_ship_score,
          scanned_file_count: null,
          clean_file_count: null,
          verdict: target.current_verdict === 'blocked' ? 'blocked' : null,
        },
        [],
        {
          incomplete,
          blocked: target.current_verdict === 'blocked',
        },
      );
  return {
    id: target.id,
    kind: 'repo',
    identifier: target.identifier,
    displayName: target.display_name ?? repo.name,
    repositoryId: repo.id,
    generatorFingerprint: target.generator_fingerprint,
    verdict: target.current_verdict ?? 'unknown',
    shipScore,
    topIssue,
    lastCheckedAt: target.last_checked_at,
    latestScanId: latest?.id ?? null,
    ownershipVerified: target.ownership_verified,
    guardianEnabled: true,
    scoreDropped: scoreDroppedFromEvidence(evidence, shipScore),
    badgeToken: target.badge_token,
    scanCapability: resolveRepoScanCapability(repo),
    lastScanFailed: failed,
    lastScanFailureReason: latest?.failure_reason ?? null,
  };
}

/**
 * Builds a verdict card for a repository that has no synced target row yet
 * (e.g. it was scanned before targets existed). Derives the verdict from the
 * latest default-branch scan so the dashboard shows real state immediately,
 * without a data backfill. Targets self-populate on the next owning scan.
 */
async function deriveCardFromLatestScan(
  db: RepoTargetCardDb,
  repo: Repository,
  target: Target | undefined,
): Promise<TargetCard> {
  const scans = await db.getRecentScans(repo.id);
  const latest = selectVerdictOwningScan(scans, repo.default_branch);
  const evidence = (target?.verdict_evidence ?? {}) as VerdictEvidenceShape;
  const base: TargetCard = {
    id: target?.id ?? `repo:${repo.id}`,
    kind: 'repo',
    identifier: repo.name,
    displayName: repo.name,
    repositoryId: repo.id,
    generatorFingerprint: target?.generator_fingerprint ?? null,
    verdict: 'unknown',
    shipScore: null,
    topIssue: null,
    lastCheckedAt: null,
    latestScanId: null,
    ownershipVerified: target?.ownership_verified ?? false,
    guardianEnabled: true,
    scoreDropped: false,
    badgeToken: target?.badge_token ?? null,
    scanCapability: resolveRepoScanCapability(repo),
    lastScanFailed: false,
    lastScanFailureReason: null,
  };
  if (!latest) return base;

  // Prefer persisted Ship Gate SoT; failed empty scans stay Unscanned (unknown).
  if (latest.verdict === 'failed' || latest.failure_reason) {
    return {
      ...base,
      lastCheckedAt: latest.created_at,
      latestScanId: latest.id,
      lastScanFailed: true,
      lastScanFailureReason: latest.failure_reason ?? null,
    };
  }
  if (typeof latest.ship_score === 'number' && latest.verdict) {
    const findings = latest.verdict === 'ready' ? [] : await db.getScanFindings(latest.id);
    const fallback = resolveVerdictFromScanFindings(findings, {
      scannedFileCount: latest.scanned_file_count ?? undefined,
      cleanFileCount: latest.clean_file_count ?? undefined,
    });
    const shipScore = resolveDisplayedShipScore(latest, findings);
    return {
      ...base,
      verdict: latest.verdict,
      shipScore,
      topIssue: fallback.topIssue,
      lastCheckedAt: latest.created_at,
      latestScanId: latest.id,
      scoreDropped: scoreDroppedFromEvidence(evidence, shipScore),
    };
  }

  const findings = await db.getScanFindings(latest.id);
  const verdict = resolveVerdictFromScanFindings(findings, {
    scannedFileCount: latest.scanned_file_count ?? undefined,
    cleanFileCount: latest.clean_file_count ?? undefined,
  });
  const shipScore = resolveDisplayedShipScore(latest, findings);
  return {
    ...base,
    verdict: verdict.status,
    shipScore,
    topIssue: verdict.topIssue,
    lastCheckedAt: latest.created_at,
    latestScanId: latest.id,
    scoreDropped: scoreDroppedFromEvidence(evidence, shipScore),
  };
}

/**
 * The dashboard's definition of the current repo card. A synced target row
 * with a numeric score on the verdict-owning scan is cheap; otherwise the card
 * is derived from the latest default-branch scan (and findings, when that scan
 * has no stored score). Feature-branch and pull-request scans never own the
 * card — a repository whose only scans are off the default branch is Unscanned.
 *
 * "Default branch" is `repo.default_branch` once a scan has reported it. Until
 * then the rule falls back to guessing main/master, which is wrong for a repo
 * that ships from anything else; one scan of any branch fixes that repository
 * for good, including its older scans.
 */
export async function buildRepoTargetCard(
  db: RepoTargetCardDb,
  repo: Repository,
  target: Target | undefined,
  latest: LatestScanSummary | null | undefined,
): Promise<TargetCard> {
  const owningLatest =
    latest && scanOwnsRepoVerdict(latest, repo.default_branch) ? latest : undefined;
  if (target && target.current_verdict && typeof owningLatest?.ship_score === 'number') {
    return cardFromTargetRow(target, repo, owningLatest);
  }
  return deriveCardFromLatestScan(db, repo, target);
}
