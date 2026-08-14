import { NextResponse } from 'next/server';
import { z } from 'zod';
import { RATE_LIMITS, requireRouteUser, secureRoute } from '../../../../../utils/apiSecurity';
import { requireRepositoryAccess } from '../../../../../utils/authorization';
import type { Scan } from '../../../../../utils/dbAdapter';
import {
  INCOMPLETE_NO_BLOCKER_FLOOR,
  INCOMPLETE_SCORE_CAP,
  resolveDisplayedShipScore,
} from '../../../../../utils/shipScoreDisplay';

const TREND_SCAN_LIMIT = 30;

const repositoryParams = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

const trendPointSchema = z.object({
  date: z.string(),
  shipScore: z.number().int().min(0).max(100),
});

/**
 * Resolve the Ship Score for a historical scan.
 * Prefer the persisted `ship_score` (source of truth). Legacy rows without it
 * fall back to recomputation without inventing a non-zero file count.
 */
export function resolveTrendShipScore(
  scan: Pick<Scan, 'ship_score' | 'scanned_file_count' | 'clean_file_count'>,
  findings: Parameters<typeof resolveDisplayedShipScore>[1],
): number {
  return resolveDisplayedShipScore(scan, findings);
}

/** Returns a chronological Ship Score series for dashboard trend charts. */
export const GET = secureRoute(
  {
    routeId: 'repositories:trend',
    auth: 'required',
    query: z.object({}).strict(),
    params: repositoryParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.read,
  },
  async ({ auth, params }) => {
    const context = requireRouteUser(auth);
    await requireRepositoryAccess(context, params.id);

    const scans = (await context.db.getRecentScans(params.id)).slice(0, TREND_SCAN_LIMIT);
    const points = await Promise.all(
      scans.map(async (scan) => {
        // Persisted scores inside the incomplete trust band skip findings fetch.
        // Above the cap or below the no-blocker floor (or legacy null) load
        // findings so incomplete Instant Gate can clamp / floor dishonest rows.
        const needsFindings =
          typeof scan.ship_score !== 'number' ||
          scan.ship_score > INCOMPLETE_SCORE_CAP ||
          scan.ship_score < INCOMPLETE_NO_BLOCKER_FLOOR;
        const findings = needsFindings ? await context.db.getScanFindings(scan.id) : [];
        return trendPointSchema.parse({
          date: scan.created_at,
          shipScore: resolveTrendShipScore(scan, findings),
        });
      }),
    );

    points.reverse();
    return NextResponse.json({ points });
  },
);
