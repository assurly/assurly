import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { verifyCronAuthorization } from '../../../../utils/cronAuth';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';
import { runGuardianBatch } from '../../../../utils/guardian';

export const maxDuration = 60;

/**
 * Daily Continuous Guardian cron (Phase 6).
 *
 * Unauthenticated by nature — Vercel Cron hits this with
 * `Authorization: Bearer <CRON_SECRET>`. The shared secret is verified BEFORE
 * any DB access or probe. A missing/invalid secret returns 401 and does no work.
 *
 * Every re-probe goes through `reprobeTargetAndRecord` → `isActiveProbeAllowed`.
 * Candidate set is ownership-verified url targets only.
 */
export const GET = secureRoute(
  {
    routeId: 'cron:guardian',
    auth: 'none',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.webhook,
  },
  async ({ request }) => {
    if (!verifyCronAuthorization(request.headers.get('authorization'))) {
      throw new ApiError(401, 'unauthorized', 'Invalid cron secret.');
    }

    const db = getAdminDbAdapter();
    const result = await runGuardianBatch({ db });

    return NextResponse.json({
      checked: result.checked,
      skipped: result.skipped,
      alerted: result.alerted,
      errors: result.errors,
      timedOut: result.timedOut,
    });
  },
);
