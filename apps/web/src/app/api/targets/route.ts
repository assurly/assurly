import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, RATE_LIMITS, requireRouteUser, secureRoute } from '../../../utils/apiSecurity';
import { countGuardedApps, isListedUrlTarget } from '../../../utils/guardedApps';
import { entitlementsForPlan } from '../../../utils/entitlements';
import { normalizeUrlIdentifier } from '../../../utils/ownership';
import { assertScannableUrl, UrlSafetyError } from '../../../utils/urlSafety';
import { resolveVerdictFromScanFindings, type Verdict } from '../../../utils/shipGate';
import type {
  DbAdapter,
  LatestScanSummary,
  Organization,
  Repository,
  RepositoryScanCapability,
  Target,
  TargetVerdict,
} from '../../../utils/dbAdapter';
import { isGitHubRepositoryName } from '../../../utils/githubApp';
import type { VerdictEvidenceShape } from '../../../utils/publicTrust';
import {
  indicatesIncompleteCoverage,
  resolveDisplayedShipScore,
  resolveTargetShipScore,
} from '../../../utils/shipScoreDisplay';

export const maxDuration = 60;

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

function resolveRepoScanCapability(repo: Repository): RepositoryScanCapability {
  if (!isGitHubRepositoryName(repo.name)) return 'invalid';
  if (repo.scan_capability === 'cli_only' || repo.scan_capability === 'invalid') {
    return repo.scan_capability;
  }
  return 'browser';
}

function scoreDroppedFromEvidence(
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

function cardFromUrlTarget(target: Target): TargetCard {
  const evidence = (target.verdict_evidence ?? {}) as VerdictEvidenceShape;
  // A url card has only the target row to go on — the same input the badge and
  // the keyed verdict API resolve from, so it uses the same resolver.
  const shipScore = resolveTargetShipScore(target);
  return {
    id: target.id,
    kind: 'url',
    identifier: target.identifier,
    displayName: target.display_name ?? target.identifier,
    repositoryId: null,
    generatorFingerprint: target.generator_fingerprint,
    verdict: target.current_verdict ?? 'unknown',
    shipScore,
    topIssue: evidence.topIssue ?? null,
    lastCheckedAt: target.last_checked_at,
    latestScanId: null,
    ownershipVerified: target.ownership_verified,
    guardianEnabled: target.ownership_verified,
    scoreDropped: scoreDroppedFromEvidence(evidence, shipScore),
    badgeToken: target.badge_token,
    scanCapability: 'browser',
    lastScanFailed: false,
    lastScanFailureReason: null,
  };
}

/**
 * Builds a verdict card for a repository that has no synced target row yet
 * (e.g. it was scanned before targets existed). Derives the verdict from the
 * latest persisted scan so the dashboard shows real state immediately, without
 * a data backfill. Targets self-populate on the next scan.
 */
async function deriveCardFromLatestScan(
  db: DbAdapter,
  repo: Repository,
  target: Target | undefined,
): Promise<TargetCard> {
  const scans = await db.getRecentScans(repo.id);
  const latest = scans[0];
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
 * Enforces the plan's guarded-app entitlement before creating a NEW url target.
 * Re-guarding an existing origin is always allowed. Fails closed on a DB count
 * error; throws 402 on a confirmed over-limit.
 */
async function assertWithinGuardedAppLimit(
  db: DbAdapter,
  organization: Organization,
  identifier: string,
): Promise<void> {
  const { guardedAppLimit } = entitlementsForPlan(organization.billing_plan);
  if (guardedAppLimit === null) return;

  let existing: Target | null;
  let repositoryCount: number;
  let urlTargetCount: number;
  try {
    existing = await db.getTargetByIdentifier(organization.id, 'url', identifier);
    if (existing) return;
    const [repos, targets] = await Promise.all([
      db.getRepositories(organization.id),
      db.getTargets(organization.id),
    ]);
    repositoryCount = repos.length;
    urlTargetCount = targets.filter((t) => t.kind === 'url').length;
  } catch {
    throw new ApiError(
      503,
      'plan_limit_unavailable',
      'Could not verify your plan limit. Try again in a moment.',
    );
  }

  const currentCount = countGuardedApps({ repositoryCount, urlTargetCount });
  if (currentCount >= guardedAppLimit) {
    throw new ApiError(
      402,
      'plan_required',
      `Your plan guards up to ${guardedAppLimit} app${guardedAppLimit === 1 ? '' : 's'}. Upgrade to guard more.`,
    );
  }
}

const createTargetBody = z
  .object({
    url: z.string().trim().min(1).max(2048),
  })
  .strict();

export const GET = secureRoute(
  {
    routeId: 'targets:read',
    auth: 'required',
    query: z.object({}).strict(),
    params: z.object({}).strict(),
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.read,
  },
  async ({ auth }) => {
    const context = requireRouteUser(auth);
    const organization = await context.db.getOrganizationByUserId(context.user.id);
    if (!organization) return NextResponse.json({ targets: [] });

    const [repos, targets] = await Promise.all([
      context.db.getRepositories(organization.id),
      context.db.getTargets(organization.id),
    ]);
    const targetByRepoId = new Map(
      targets.filter((t) => t.repository_id).map((t) => [t.repository_id as string, t]),
    );
    // One-off probes never create rows; every url target here was explicitly Guarded.
    const urlTargets = targets.filter(isListedUrlTarget);

    const latestByRepoId = await context.db.getLatestScanSummaries(repos.map((repo) => repo.id));

    // A synced target row is authoritative and cheap; only repos without one
    // pay for a latest-scan derivation. All cards are built in parallel.
    const repoCards = await Promise.all(
      repos.map(async (repo): Promise<TargetCard> => {
        const target = targetByRepoId.get(repo.id);
        const latest = latestByRepoId.get(repo.id);
        if (target && target.current_verdict && typeof latest?.ship_score === 'number') {
          return cardFromTargetRow(target, repo, latest);
        }
        return deriveCardFromLatestScan(context.db, repo, target);
      }),
    );

    const cards = [...repoCards, ...urlTargets.map(cardFromUrlTarget)];

    // Most urgent first: blocked, then review, then ready, then unscanned.
    const order: Record<TargetVerdict, number> = { blocked: 0, review: 1, ready: 2, unknown: 3 };
    cards.sort((a, b) => order[a.verdict] - order[b.verdict]);

    return NextResponse.json({ targets: cards });
  },
);

/**
 * Explicitly guard a live URL (add to Your apps after ownership verification).
 * Does NOT run a scan — the client scans first, then calls this when the user
 * chooses to monitor the origin. Plan limit is enforced here, not on scan-url.
 */
export const POST = secureRoute(
  {
    routeId: 'targets:create',
    auth: 'required',
    query: z.object({}).strict(),
    params: z.object({}).strict(),
    body: createTargetBody,
    bodyMode: 'json',
    maxBodyBytes: 4 * 1024,
    rateLimit: RATE_LIMITS.sensitive,
    csrf: true,
  },
  async ({ auth, body }) => {
    const context = requireRouteUser(auth);
    const organization = await context.db.getOrganizationByUserId(context.user.id);
    if (!organization) throw new ApiError(404, 'not_found', 'Workspace not found.');

    let parsedUrl: URL;
    try {
      parsedUrl = assertScannableUrl(body.url);
    } catch (error) {
      if (error instanceof UrlSafetyError) {
        throw new ApiError(400, 'invalid_url', error.message);
      }
      throw error;
    }

    const identifier = normalizeUrlIdentifier(parsedUrl.toString());
    await assertWithinGuardedAppLimit(context.db, organization, identifier);

    const row = await context.db.upsertTarget({
      organizationId: organization.id,
      kind: 'url',
      identifier,
      displayName: identifier,
    });

    return NextResponse.json({
      target: {
        id: row.id,
        kind: row.kind,
        identifier: row.identifier,
        ownershipVerified: row.ownership_verified,
      },
    });
  },
);
