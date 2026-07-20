import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { requireScanAccess } from '../../../../utils/authorization';
import { getApplicationUrl } from '../../../../utils/env';

const shareBody = z
  .object({
    scanId: z.string().uuid(),
  })
  .strict();

export const POST = secureRoute(
  {
    routeId: 'scans:share',
    auth: 'required',
    query: z.object({}).strict(),
    params: z.object({}).strict(),
    body: shareBody,
    bodyMode: 'json',
    maxBodyBytes: 4096,
    rateLimit: RATE_LIMITS.write,
    csrf: true,
  },
  async ({ auth, body }) => {
    const context = requireRouteUser(auth);
    const organization = await context.db.getOrganizationByUserId(context.user.id);
    if (!organization || organization.billing_plan !== 'pro') {
      throw new ApiError(
        403,
        'plan_required',
        'Shareable Ship Gate reports are available on the Pro plan.',
      );
    }

    await requireScanAccess(context, body.scanId);
    const existing = await context.db.getScan(body.scanId);
    if (!existing) throw new ApiError(404, 'not_found', 'Scan not found.');

    const shareToken = existing.share_token || crypto.randomBytes(16).toString('hex');
    let scan = existing;
    if (!existing.share_token) {
      try {
        scan = await context.db.setScanShareToken(body.scanId, shareToken);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        // Two distinct ways the environment can lack share support, both of which
        // must degrade to an actionable message rather than a bare 500:
        //   * the `share_token` COLUMN is missing (20260626120000 not applied)
        //   * the UPDATE grant/policy is missing (20260720000000 not applied) —
        //     Postgres answers "permission denied", or RLS filters the row out
        //     and the adapter reports that no row matched.
        if (
          /share_token|column|schema cache|permission denied|row-level security|matched no scan row/i.test(
            detail,
          )
        ) {
          throw new ApiError(
            503,
            'share_unavailable',
            'Shareable reports are not enabled on this environment yet. Apply the latest database migration.',
          );
        }
        throw error;
      }
    }

    const baseUrl = getApplicationUrl().replace(/\/$/, '');
    return NextResponse.json({
      token: scan.share_token,
      url: `${baseUrl}/report/${scan.share_token}`,
    });
  },
);
