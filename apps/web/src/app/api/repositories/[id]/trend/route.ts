import { NextResponse } from 'next/server';
import { z } from 'zod';
import { RATE_LIMITS, requireRouteUser, secureRoute } from '../../../../../utils/apiSecurity';
import { requireRepositoryAccess } from '../../../../../utils/authorization';
import { buildShipGateFromScanFindings } from '../../../../../utils/shipGate';

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

    const scans = (await context.db.getRecentScans(params.id)).slice(0, TREND_SCAN_LIMIT);
    const points = await Promise.all(
      scans.map(async (scan) => {
        const findings = await context.db.getScanFindings(scan.id);
        const affectedPaths = new Set(findings.map((finding) => finding.file_path));
        const shipGate = buildShipGateFromScanFindings(findings, {
          scannedFileCount: Math.max(affectedPaths.size, 1),
          cleanFileCount: 0,
        });
        return trendPointSchema.parse({
          date: scan.created_at,
          shipScore: shipGate.shipScore,
        });
      }),
    );

    points.reverse();
    return NextResponse.json({ points });
  },
);
