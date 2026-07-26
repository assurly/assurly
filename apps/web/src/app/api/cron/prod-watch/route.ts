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
import { isProdWatchFeatureEnabled, runProdWatchBatch } from '../../../../utils/prodWatch';

export const maxDuration = 60;

/**
 * Prod Watch cron (D5c). Mirrors guardian cron auth: Bearer CRON_SECRET
 * verified before any DB or outbound work. Feature-flagged off by default.
 *
 * Unreachable customer projects degrade to not_checked and never fail the batch.
 */
export const GET = secureRoute(
  {
    routeId: 'cron:prod-watch',
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

    if (!isProdWatchFeatureEnabled()) {
      return NextResponse.json({
        enabled: false,
        checked: 0,
        skipped: 0,
        alerted: 0,
        errors: 0,
        timedOut: false,
      });
    }

    const db = getAdminDbAdapter();
    const result = await runProdWatchBatch({ db });

    return NextResponse.json({
      enabled: true,
      checked: result.checked,
      skipped: result.skipped,
      alerted: result.alerted,
      errors: result.errors,
      timedOut: result.timedOut,
    });
  },
);
