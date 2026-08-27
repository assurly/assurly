import { z } from 'zod';
import { buildShipGateFromScanFindings } from '../../../../utils/shipGate';
import { RATE_LIMITS, secureRoute } from '../../../../utils/apiSecurity';
import { getAdminDbAdapter, type Target } from '../../../../utils/dbAdapter';
import { getApplicationUrl } from '../../../../utils/env';
import { resolveTargetShipScore } from '../../../../utils/shipScoreDisplay';

const SHARE_TOKEN_PATTERN = /^[a-f0-9]{32}$/;

const tokenParams = z
  .object({
    token: z.string().min(1).max(64),
  })
  .strict();

function badgeColor(status: 'ready' | 'review' | 'blocked' | 'unknown'): string {
  switch (status) {
    case 'ready':
      return '#166534';
    case 'review':
      return '#b45309';
    case 'blocked':
      return '#b91c1c';
    case 'unknown':
      return '#475569';
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

/**
 * Founders embed: "Verified by Assurly · Ship Score N/100".
 * Links back to the public trust page (growth loop).
 * A null score renders an explicit unscored variant — this badge goes into
 * users' READMEs, so it must never invent a number we do not have.
 */
function buildBadgeSvg(
  shipScore: number | null,
  status: 'ready' | 'review' | 'blocked' | 'unknown',
  trustHref: string | null,
): string {
  const fill = badgeColor(status);
  const label =
    shipScore == null
      ? 'Assurly · Ship Score unavailable'
      : `Verified by Assurly · Ship Score ${shipScore}/100`;
  const inner = `<rect width="260" height="28" rx="4" fill="${fill}"/><text x="130" y="19" fill="#ffffff" font-family="system-ui,sans-serif" font-size="12" font-weight="600" text-anchor="middle">${label}</text>`;
  if (trustHref) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="28" role="img" aria-label="${label}"><a href="${trustHref}" target="_blank" rel="noopener">${inner}</a></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="28" role="img" aria-label="${label}">${inner}</svg>`;
}

function trustPageUrl(token: string): string {
  try {
    return `${getApplicationUrl().replace(/\/$/, '')}/report/${token}`;
  } catch {
    return `/report/${token}`;
  }
}

function scoreFromTarget(target: Target): {
  shipScore: number | null;
  status: 'ready' | 'review' | 'blocked' | 'unknown';
} {
  return {
    shipScore: resolveTargetShipScore(target),
    status: target.current_verdict ?? 'unknown',
  };
}

/** Public Ship Score badge as SVG — prefers live target badge_token, falls back to scan share token. */
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

    // Prefer the live target projection (Phase 6 growth loop).
    const target = await db.getTargetByBadgeToken(params.token);
    if (target) {
      const { shipScore, status } = scoreFromTarget(target);
      return new Response(buildBadgeSvg(shipScore, status, trustPageUrl(params.token)), {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
        },
      });
    }

    // Backward-compat: scan share tokens still render a badge.
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

    return new Response(
      buildBadgeSvg(shipGate.shipScore, shipGate.status, trustPageUrl(params.token)),
      {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
        },
      },
    );
  },
);

export { buildBadgeSvg, badgeColor };
