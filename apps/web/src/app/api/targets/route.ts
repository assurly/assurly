import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, RATE_LIMITS, requireRouteUser, secureRoute } from '../../../utils/apiSecurity';
import { countGuardedApps, isListedUrlTarget } from '../../../utils/guardedApps';
import { entitlementsForPlan } from '../../../utils/entitlements';
import { normalizeUrlIdentifier } from '../../../utils/ownership';
import { assertScannableUrl, UrlSafetyError } from '../../../utils/urlSafety';
import type { DbAdapter, Organization, Target, TargetVerdict } from '../../../utils/dbAdapter';
import type { VerdictEvidenceShape } from '../../../utils/publicTrust';
import {
  buildRepoTargetCard,
  scoreDroppedFromEvidence,
  type TargetCard,
} from '../../../utils/repoTargetCard';
import { resolveTargetShipScore } from '../../../utils/shipScoreDisplay';

export const maxDuration = 60;

export type { TargetCard };

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

    // Built from repos we already loaded, so the branch rule costs no extra query.
    const defaultBranchByRepoId = new Map(repos.map((repo) => [repo.id, repo.default_branch]));
    const latestByRepoId = await context.db.getLatestScanSummaries(
      repos.map((repo) => repo.id),
      defaultBranchByRepoId,
    );

    const repoCards = await Promise.all(
      repos.map((repo): Promise<TargetCard> => {
        const target = targetByRepoId.get(repo.id);
        const latest = latestByRepoId.get(repo.id);
        return buildRepoTargetCard(context.db, repo, target, latest);
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
