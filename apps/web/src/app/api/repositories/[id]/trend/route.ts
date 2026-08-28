import { NextResponse } from 'next/server';
import { z } from 'zod';
import { RATE_LIMITS, requireRouteUser, secureRoute } from '../../../../../utils/apiSecurity';
import { requireRepositoryAccess } from '../../../../../utils/authorization';
import { selectLatestScanPerCommit } from '../../../../../utils/scanHistoryDisplay';
import { resolveDisplayedShipScore } from '../../../../../utils/shipScoreDisplay';

export const maxDuration = 60;

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

    const scans = selectLatestScanPerCommit(await context.db.getRecentScans(params.id)).slice(
      0,
      TREND_SCAN_LIMIT,
    );
    const resolved = await Promise.all(
      scans.map(async (scan) => {
        try {
          const findings =
            typeof scan.ship_score === 'number' ? [] : await context.db.getScanFindings(scan.id);
          return trendPointSchema.parse({
            date: scan.created_at,
            shipScore: Math.round(resolveDisplayedShipScore(scan, findings)),
          });
        } catch {
          return null;
        }
      }),
    );

    const points = resolved.filter(
      (point): point is { date: string; shipScore: number } => point !== null,
    );
    points.reverse();
    return NextResponse.json({ points });
  },
);
