import { z } from 'zod';
import { buildShipGateFromScanFindings } from '../../../../utils/shipGate';
import { RATE_LIMITS, secureRoute } from '../../../../utils/apiSecurity';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';

const SHARE_TOKEN_PATTERN = /^[a-f0-9]{32}$/;

const tokenParams = z
  .object({
    token: z.string().min(1).max(64),
  })
  .strict();

function badgeColor(status: 'ready' | 'review' | 'blocked'): string {
  switch (status) {
    case 'ready':
      return '#166534';
    case 'review':
      return '#b45309';
    case 'blocked':
      return '#b91c1c';
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

function buildBadgeSvg(shipScore: number, status: 'ready' | 'review' | 'blocked'): string {
  const fill = badgeColor(status);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="28" role="img" aria-label="Ship Score ${shipScore} out of 100"><rect width="180" height="28" rx="4" fill="${fill}"/><text x="90" y="19" fill="#ffffff" font-family="system-ui,sans-serif" font-size="13" font-weight="600" text-anchor="middle">Ship Score ${shipScore}/100</text></svg>`;
}

/** Public Ship Score badge as SVG for README embeds. */
export const GET = secureRoute(
  {
    routeId: 'badge:read',
    auth: 'none',
    query: z.object({}).strict(),
    params: tokenParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.public,
  },
  async ({ params }) => {
    if (!SHARE_TOKEN_PATTERN.test(params.token)) {
      return new Response(null, { status: 404 });
    }

    const db = getAdminDbAdapter();
    const scan = await db.getScanByShareToken(params.token);
    if (!scan) {
      return new Response(null, { status: 404 });
    }

    const findings = await db.getScanFindings(scan.id);
    const affectedPaths = new Set(findings.map((finding) => finding.file_path));
    const shipGate = buildShipGateFromScanFindings(findings, {
      scannedFileCount: Math.max(affectedPaths.size, 1),
      cleanFileCount: 0,
    });

    return new Response(buildBadgeSvg(shipGate.shipScore, shipGate.status), {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      },
    });
  },
);

export { buildBadgeSvg, badgeColor };
