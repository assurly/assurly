import { z } from 'zod';
import { buildShipGateFromScanFindings } from '../../../../utils/shipGate';
import { RATE_LIMITS, secureRoute } from '../../../../utils/apiSecurity';
import { getAdminDbAdapter, type Target } from '../../../../utils/dbAdapter';
import { getApplicationUrl } from '../../../../utils/env';
import { resolveTargetShipScore } from '../../../../utils/shipScoreDisplay';
import { resolveScanFreshness, resolveTargetFreshness } from '../../../../utils/targetFreshness';
import type { VerdictFreshness } from '../../../../utils/verdictFreshness';

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
const MIN_BADGE_WIDTH = 260;
/** Rough advance width of the 12px semibold label font, in px per character. */
const BADGE_CHAR_WIDTH = 6.6;
const BADGE_PADDING = 24;

function badgeLabel(shipScore: number | null, freshness: VerdictFreshness): string {
  if (shipScore == null) return 'Assurly · Ship Score unavailable';
  // An out-of-date score is history, not a verification: no "Verified by".
  switch (freshness.status) {
    case 'code_changed':
      return `Assurly · Ship Score ${shipScore}/100 · code changed since`;
    case 'old':
      return `Assurly · Ship Score ${shipScore}/100 · ${freshness.daysOld} ${
        freshness.daysOld === 1 ? 'day' : 'days'
      } old`;
    case 'current':
    case 'unknown':
      return `Verified by Assurly · Ship Score ${shipScore}/100`;
    default: {
      const neverStatus: never = freshness.status;
      return neverStatus;
    }
  }
}

/**
 * The badge goes into READMEs and outlives the check behind it, so an
 * out-of-date score turns grey and says why instead of staying green.
 */
function buildBadgeSvg(
  shipScore: number | null,
  status: 'ready' | 'review' | 'blocked' | 'unknown',
  trustHref: string | null,
  freshness: VerdictFreshness = { status: 'current', daysOld: 0 },
): string {
  const outOfDate = freshness.status === 'old' || freshness.status === 'code_changed';
  const fill = badgeColor(outOfDate && shipScore != null ? 'unknown' : status);
  const label = badgeLabel(shipScore, freshness);
  const width = Math.max(
    MIN_BADGE_WIDTH,
    Math.ceil(label.length * BADGE_CHAR_WIDTH + BADGE_PADDING),
  );
  const inner = `<rect width="${width}" height="28" rx="4" fill="${fill}"/><text x="${width / 2}" y="19" fill="#ffffff" font-family="system-ui,sans-serif" font-size="12" font-weight="600" text-anchor="middle">${label}</text>`;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28" role="img" aria-label="${label}">`;
  if (trustHref) {
    return `${open}<a href="${trustHref}" target="_blank" rel="noopener">${inner}</a></svg>`;
  }
  return `${open}${inner}</svg>`;
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
      const freshness = await resolveTargetFreshness(db, target);
      return new Response(buildBadgeSvg(shipScore, status, trustPageUrl(params.token), freshness), {
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

    const freshness = await resolveScanFreshness(db, scan);
    return new Response(
      buildBadgeSvg(shipGate.shipScore, shipGate.status, trustPageUrl(params.token), freshness),
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
