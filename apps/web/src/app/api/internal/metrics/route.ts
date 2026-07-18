import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { verifyBearerSecret } from '../../../../utils/bearerSecret';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';
import { rollupExitMetrics } from '../../../../utils/exitMetrics';

/**
 * Internal exit-readiness metrics (Phase 8).
 *
 * Aggregate-ONLY: the payload is built from `getFixOutcomeCorpus` (pattern
 * columns only — never a finding message, table name, PII, or per-customer row)
 * plus a scalar app count. There is no per-org or per-target breakdown here.
 *
 * Access is gated by a shared secret (`METRICS_SECRET`) verified BEFORE any DB
 * access — this surface is for the owner/acquirer, not customers, and the app has
 * no platform-admin role. A missing/invalid secret returns 401 and does no work.
 */
export const GET = secureRoute(
  {
    routeId: 'internal:metrics',
    auth: 'none',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.sensitive,
  },
  async ({ request }) => {
    if (!verifyBearerSecret(request.headers.get('authorization'), process.env.METRICS_SECRET)) {
      throw new ApiError(401, 'unauthorized', 'Invalid metrics secret.');
    }

    const db = getAdminDbAdapter();
    const [corpus, appsMonitored] = await Promise.all([
      db.getFixOutcomeCorpus(),
      db.countMonitoredApps(),
    ]);

    return NextResponse.json(rollupExitMetrics(corpus, appsMonitored));
  },
);
