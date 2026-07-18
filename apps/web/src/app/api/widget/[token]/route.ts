import { z } from 'zod';
import { RATE_LIMITS, secureRoute } from '../../../../utils/apiSecurity';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';
import { toPublicTrustProjection, type PublicTrustProjection } from '../../../../utils/publicTrust';

const BADGE_TOKEN_PATTERN = /^[a-f0-9]{32}$/;

const tokenParams = z.object({ token: z.string().min(1).max(64) }).strict();
const widgetQuery = z
  .object({
    label: z.string().max(40).optional(),
  })
  .strict();

const DEFAULT_BRAND = 'Assurly';

function verdictColor(verdict: PublicTrustProjection['verdict']): string {
  switch (verdict) {
    case 'ready':
      return '#166534';
    case 'review':
      return '#b45309';
    case 'blocked':
      return '#b91c1c';
    case 'unknown':
      return '#475569';
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}

function verdictLabel(verdict: PublicTrustProjection['verdict']): string {
  switch (verdict) {
    case 'ready':
      return 'Ready to ship';
    case 'review':
      return 'Review recommended';
    case 'blocked':
      return 'Not ready';
    case 'unknown':
      return 'Not yet checked';
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}

/** XML-escape and restrict a caller-supplied branding label (SVG-injection safe). */
function sanitizeBrand(raw: string | undefined): string {
  const cleaned = (raw ?? '')
    .replace(/[^\w .,&'-]/g, '')
    .trim()
    .slice(0, 40);
  const brand = cleaned || DEFAULT_BRAND;
  return brand
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * White-label "security-checked" embed widget (Phase 7 OEM surface). A platform
 * (Lovable/Bolt/agency) embeds `<img src=".../api/widget/<token>?label=Acme">` to
 * surface a verdict to its own users.
 *
 * Backed by the Phase-6 badge token + `toPublicTrustProjection` — SHAPE ONLY
 * (verdict, score, coarse category). Never evidence, PII, or the exposed table
 * name. Only the branding label is configurable; the underlying data is not.
 */
export const GET = secureRoute(
  {
    routeId: 'widget:read',
    auth: 'none',
    query: widgetQuery,
    params: tokenParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.public,
  },
  async ({ params, query }) => {
    if (!BADGE_TOKEN_PATTERN.test(params.token)) {
      return new Response(null, { status: 404 });
    }

    const db = getAdminDbAdapter();
    const target = await db.getTargetByBadgeToken(params.token);
    const projection = target ? toPublicTrustProjection(target) : null;
    if (!projection) return new Response(null, { status: 404 });

    const brand = sanitizeBrand(query.label);
    const score = projection.shipScore ?? (projection.verdict === 'ready' ? 100 : 0);
    const accent = verdictColor(projection.verdict);
    const state = verdictLabel(projection.verdict);
    // Coarse category only (already shape-safe via toPublicIssueCategory).
    const issue = projection.topIssue ? projection.topIssue.category : 'No blocking issues';

    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="96" role="img" aria-label="Security-checked by ${brand}: ${state}, ship score ${score} of 100">`,
      '<rect width="320" height="96" rx="10" fill="#0f172a"/>',
      `<rect x="0" y="0" width="6" height="96" rx="3" fill="${accent}"/>`,
      `<text x="20" y="30" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="13" font-weight="600">Security-checked by ${brand}</text>`,
      `<text x="20" y="56" fill="#ffffff" font-family="system-ui,sans-serif" font-size="18" font-weight="700">${state} · ${score}/100</text>`,
      `<text x="20" y="78" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="11">${issue}</text>`,
      '</svg>',
    ].join('');

    return new Response(svg, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      },
    });
  },
);
