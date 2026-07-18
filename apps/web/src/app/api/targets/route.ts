import { NextResponse } from 'next/server';
import { z } from 'zod';
import { RATE_LIMITS, requireRouteUser, secureRoute } from '../../../utils/apiSecurity';
import { resolveVerdictFromScanFindings, type Verdict } from '../../../utils/shipGate';
import type { DbAdapter, Repository, Target, TargetVerdict } from '../../../utils/dbAdapter';
import type { VerdictEvidenceShape } from '../../../utils/publicTrust';

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
}

function scoreDroppedFromEvidence(
  evidence: VerdictEvidenceShape,
  currentScore: number | null,
): boolean {
  const previous = evidence.previousShipScore;
  if (previous == null || currentScore == null) return false;
  return currentScore < previous;
}

function cardFromTargetRow(
  target: Target,
  repo: Repository,
  latestScanId: string | null,
): TargetCard {
  const evidence = (target.verdict_evidence ?? {}) as VerdictEvidenceShape;
  return {
    id: target.id,
    kind: 'repo',
    identifier: target.identifier,
    displayName: target.display_name ?? repo.name,
    repositoryId: repo.id,
    generatorFingerprint: target.generator_fingerprint,
    verdict: target.current_verdict ?? 'unknown',
    shipScore: target.current_ship_score,
    topIssue: evidence.topIssue ?? null,
    lastCheckedAt: target.last_checked_at,
    latestScanId,
    ownershipVerified: target.ownership_verified,
    guardianEnabled: true,
    scoreDropped: scoreDroppedFromEvidence(evidence, target.current_ship_score),
    badgeToken: target.badge_token,
  };
}

function cardFromUrlTarget(target: Target): TargetCard {
  const evidence = (target.verdict_evidence ?? {}) as VerdictEvidenceShape;
  return {
    id: target.id,
    kind: 'url',
    identifier: target.identifier,
    displayName: target.display_name ?? target.identifier,
    repositoryId: null,
    generatorFingerprint: target.generator_fingerprint,
    verdict: target.current_verdict ?? 'unknown',
    shipScore: target.current_ship_score,
    topIssue: evidence.topIssue ?? null,
    lastCheckedAt: target.last_checked_at,
    latestScanId: null,
    ownershipVerified: target.ownership_verified,
    guardianEnabled: target.ownership_verified,
    scoreDropped: scoreDroppedFromEvidence(evidence, target.current_ship_score),
    badgeToken: target.badge_token,
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
  };
  if (!latest) return base;

  const findings = await db.getScanFindings(latest.id);
  const verdict = resolveVerdictFromScanFindings(findings);
  return {
    ...base,
    verdict: verdict.status,
    shipScore: verdict.shipScore,
    topIssue: verdict.topIssue,
    lastCheckedAt: latest.created_at,
    latestScanId: latest.id,
    scoreDropped: scoreDroppedFromEvidence(evidence, verdict.shipScore),
  };
}

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
    const urlTargets = targets.filter((t) => t.kind === 'url');

    // A synced target row is authoritative and cheap; only repos without one
    // pay for a latest-scan derivation. All cards are built in parallel.
    const repoCards = await Promise.all(
      repos.map(async (repo): Promise<TargetCard> => {
        const target = targetByRepoId.get(repo.id);
        if (target && target.current_verdict) {
          const scans = await context.db.getRecentScans(repo.id);
          return cardFromTargetRow(target, repo, scans[0]?.id ?? null);
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
