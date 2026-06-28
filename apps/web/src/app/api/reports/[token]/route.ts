import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildShipGateFromScanFindings } from '../../../../utils/shipGate';
import { ApiError, RATE_LIMITS, secureRoute } from '../../../../utils/apiSecurity';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';

const tokenParams = z
  .object({
    token: z.string().regex(/^[a-f0-9]{32}$/),
  })
  .strict();

export const GET = secureRoute(
  {
    routeId: 'reports:read',
    auth: 'none',
    query: z.object({}).strict(),
    params: tokenParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.public,
  },
  async ({ params }) => {
    const db = getAdminDbAdapter();
    const scan = await db.getScanByShareToken(params.token);
    if (!scan) throw new ApiError(404, 'not_found', 'Report not found or no longer shared.');

    const [findings, repositoryName] = await Promise.all([
      db.getScanFindings(scan.id),
      db.getRepositoryNameForScan(scan.id),
    ]);

    const affectedPaths = new Set(findings.map((finding) => finding.file_path));
    const shipGate = buildShipGateFromScanFindings(findings, {
      scannedFileCount: Math.max(affectedPaths.size, 1),
      cleanFileCount: 0,
    });

    return NextResponse.json({
      scan: {
        id: scan.id,
        commit_sha: scan.commit_sha,
        branch: scan.branch,
        status: scan.status,
        created_at: scan.created_at,
        repository_name: repositoryName,
      },
      shipGate,
      findings,
    });
  },
);
