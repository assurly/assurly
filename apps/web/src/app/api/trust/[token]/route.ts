import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, RATE_LIMITS, secureRoute } from '../../../../utils/apiSecurity';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';
import { toPublicTrustProjection } from '../../../../utils/publicTrust';

const tokenParams = z
  .object({
    token: z.string().regex(/^[a-f0-9]{32}$/),
  })
  .strict();

/**
 * Public trust-page projection keyed by `targets.badge_token` (Phase 6).
 * Whitelisted shape only — never evidence rows, never PII.
 */
export const GET = secureRoute(
  {
    routeId: 'trust:read',
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
    const target = await db.getTargetByBadgeToken(params.token);
    if (!target) throw new ApiError(404, 'not_found', 'Trust page not found.');

    const projection = toPublicTrustProjection(target);
    if (!projection) throw new ApiError(404, 'not_found', 'Trust page not found.');

    return NextResponse.json(projection);
  },
);
