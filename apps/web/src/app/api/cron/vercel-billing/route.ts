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
import { runVercelBilling } from '../../../../utils/vercelBillingRun';
import { createVercelMarketplaceApi } from '../../../../utils/vercelMarketplaceApi';
import { decryptVercelToken } from '../../../../utils/vercelToken';

export const maxDuration = 300;

/**
 * Vercel Marketplace billing run: sends each installation's running total and
 * invoices the month that ended. Every step is safe to repeat.
 *
 * Vercel asks for billing data hourly. The Hobby plan allows daily crons only,
 * so the schedule in vercel.json is daily until the team moves to Pro (which
 * the native integration needs anyway); then it becomes `0 * * * *`.
 *
 * Like the Guardian cron, the shared secret is checked before any work.
 */
export const GET = secureRoute(
  {
    routeId: 'cron:vercel-billing',
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
    const report = await runVercelBilling(new Date(), {
      db: getAdminDbAdapter(),
      decryptToken: decryptVercelToken,
      apiFor: (token) => createVercelMarketplaceApi(token),
    });
    return NextResponse.json(report);
  },
);
